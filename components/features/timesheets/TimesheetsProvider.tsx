'use client';

import {
  createContext, useContext, useCallback, useEffect, useMemo, useRef, useState, ReactNode,
} from 'react';
import type { TimeEntry, TimerState, AiSuggestion, TimeEntryType, TsClient, TsStaff, WeekStatus, WeekApprovalStatus } from '@/lib/timesheets/types';
import {
  SEED_STAFF, SEED_CLIENTS, SEED_ACTIVITIES, ME_ID, generateSeedEntries, generateSampleForUser,
} from '@/lib/timesheets/seed';
import { generateDemoSuggestions } from '@/lib/timesheets/suggestions';
import { canAccessTimesheets } from '@/lib/timesheets/access';
import { todayIso, startOfWeek, addDays } from '@/lib/timesheets/format';

const weekKey = (userId: string, weekStart: string) => `${userId}__${weekStart}`;

const META_PREFIX = 'smith.timesheets.meta.';   // { timer, suggestions } — both modes
const DEMO_PREFIX = 'smith.timesheets.demo.';    // { entries, seeded } — demo mode only

type Mode = 'loading' | 'live' | 'demo';

interface StartConfig {
  clientId: string | null;
  clientName: string;
  taskId?: string | null;
  taskTitle: string;
  activity: string;
  department: string;
  type: TimeEntryType;
  notes?: string;
}

interface TimesheetsContextValue {
  ready: boolean;
  mode: Mode;
  /** Whether the current user is allowed to use Timesheets (preview gate). */
  allowed: boolean;
  userId: string;
  meId: string;
  isAdmin: boolean;
  entries: TimeEntry[];
  staff: TsStaff[];
  clients: TsClient[];
  activities: typeof SEED_ACTIVITIES;
  suggestions: AiSuggestion[];
  scanning: boolean;
  hasSampleData: boolean;
  loadingSample: boolean;
  updateStaffRate: (id: string, patch: { ratePence?: number; weeklyCapacityHours?: number; department?: string }) => void;

  // Client budgets (weekly minutes) — Budget-vs-Actual report.
  clientBudgets: Record<string, number>;
  setClientBudget: (clientId: string, weeklyMinutes: number) => void;

  // Week approval workflow.
  weekStatuses: Record<string, WeekStatus>;   // keyed `${userId}__${weekStart}`
  weekStatusFor: (userId: string, weekStart: string) => WeekApprovalStatus;
  isWeekLocked: (weekStart: string) => boolean; // for the current user
  submitWeek: (weekStart: string) => void;
  withdrawWeek: (weekStart: string) => void;
  reviewWeek: (userId: string, weekStart: string, action: 'approve' | 'reject', note?: string) => void;

  timer: TimerState;
  elapsedMs: number;

  ensureSeeded: () => void;
  loadSampleWeek: () => Promise<void>;

  startTimer: (cfg: StartConfig) => void;
  pauseTimer: () => void;
  resumeTimer: () => void;
  stopTimer: (save: boolean) => void;
  updateTimerMeta: (patch: Partial<StartConfig>) => void;

  addEntry: (e: Omit<TimeEntry, 'id'>) => void;
  updateEntry: (id: string, patch: Partial<TimeEntry>) => void;
  deleteEntry: (id: string) => void;

  scanForWork: () => Promise<void>;
  acceptSuggestion: (id: string) => void;
  dismissSuggestion: (id: string) => void;
}

const emptyTimer: TimerState = {
  running: false, paused: false, segmentStartedAt: null, accumulatedMs: 0,
  clientId: null, clientName: '', taskId: null, taskTitle: '', activity: '', department: '', type: 'billable', notes: '',
};

const Ctx = createContext<TimesheetsContextValue | null>(null);

export function useTimesheets(): TimesheetsContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useTimesheets must be used within TimesheetsProvider');
  return v;
}

const tmpId = () => `tmp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
const hashHue = (id: string) => { let h = 0; for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) & 0xffff; return h % 360; };
const roleRate = (role: string) => (role === 'admin' ? 15000 : 11000);

interface StaffDto {
  id: string;
  full_name: string | null;
  email: string;
  role: string;
  charge_out_rate_pence?: number | null;
  weekly_capacity_hours?: number | null;
  department?: string | null;
}

const DEFAULT_CAPACITY_HOURS = 37.5;

function mapStaff(members: StaffDto[], userId: string, userName: string): TsStaff[] {
  const rows = members.map(m => ({
    id: m.id,
    name: m.id === userId ? (userName || m.full_name || 'You') : (m.full_name || m.email?.split('@')[0] || 'Team member'),
    role: m.role === 'admin' ? 'Admin' : 'Staff',
    department: m.department || 'Unassigned',
    weeklyCapacityHours: m.weekly_capacity_hours ?? DEFAULT_CAPACITY_HOURS,
    ratePence: m.charge_out_rate_pence ?? roleRate(m.role),
    hue: hashHue(m.id),
  }));
  if (!rows.some(r => r.id === userId)) {
    rows.unshift({ id: userId, name: userName || 'You', role: 'Staff', department: 'Unassigned', weeklyCapacityHours: DEFAULT_CAPACITY_HOURS, ratePence: 12000, hue: hashHue(userId) });
  }
  return rows;
}

export default function TimesheetsProvider({
  userId, userName, userRole, userEmail, children,
}: { userId: string; userName: string; userRole: string; userEmail: string; children: ReactNode }) {
  const allowed = canAccessTimesheets(userEmail);
  const [ready, setReady] = useState(false);
  const [mode, setMode] = useState<Mode>('loading');
  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [liveStaff, setLiveStaff] = useState<TsStaff[] | null>(null);
  const [liveClients, setLiveClients] = useState<TsClient[] | null>(null);
  // Demo-mode edits to rate/capacity (live mode edits liveStaff directly).
  const [staffOverrides, setStaffOverrides] = useState<Record<string, { ratePence?: number; weeklyCapacityHours?: number; department?: string }>>({});
  const [clientBudgets, setClientBudgets] = useState<Record<string, number>>({});
  const [weekStatuses, setWeekStatuses] = useState<Record<string, WeekStatus>>({});
  const [suggestions, setSuggestions] = useState<AiSuggestion[]>([]);
  const [timer, setTimer] = useState<TimerState>(emptyTimer);
  const [scanning, setScanning] = useState(false);
  const [loadingSample, setLoadingSample] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const seededRef = useRef(false);
  const modeRef = useRef<Mode>('loading');
  modeRef.current = mode;

  const metaKey = `${META_PREFIX}${userId || 'anon'}`;
  const demoKey = `${DEMO_PREFIX}${userId || 'anon'}`;

  const meId = mode === 'live' ? userId : ME_ID;
  const isAdmin = userRole === 'admin';

  const staff = useMemo<TsStaff[]>(() => {
    const base = mode === 'live' && liveStaff
      ? liveStaff
      : SEED_STAFF.map(s => (s.id === ME_ID ? { ...s, name: userName || 'You' } : s));
    // Apply demo-mode rate/capacity overrides (live mode edits liveStaff directly).
    if (mode === 'live') return base;
    return base.map(s => (staffOverrides[s.id] ? { ...s, ...staffOverrides[s.id] } : s));
  }, [mode, liveStaff, userName, staffOverrides]);

  const clients = useMemo<TsClient[]>(() => {
    if (mode === 'live' && liveClients) return liveClients;
    return SEED_CLIENTS;
  }, [mode, liveClients]);

  // ── Load: decide live vs demo, hydrate accordingly ─────────────────────────
  useEffect(() => {
    // Preview gate — users without access never load data or hit the API.
    if (!allowed) { setMode('demo'); setReady(true); return; }
    let cancelled = false;

    // Meta (timer + suggestions + demo rate overrides) is device-local.
    try {
      const raw = window.localStorage.getItem(metaKey);
      if (raw) {
        const m = JSON.parse(raw) as {
          timer?: TimerState; suggestions?: AiSuggestion[];
          staffOverrides?: Record<string, { ratePence?: number; weeklyCapacityHours?: number; department?: string }>;
          clientBudgets?: Record<string, number>; weekStatuses?: Record<string, WeekStatus>;
        };
        if (m.timer) setTimer(m.timer);
        if (m.suggestions) setSuggestions(m.suggestions);
        if (m.staffOverrides) setStaffOverrides(m.staffOverrides);
        if (m.clientBudgets) setClientBudgets(m.clientBudgets);
        if (m.weekStatuses) setWeekStatuses(m.weekStatuses);
      }
    } catch { /* ignore */ }

    (async () => {
      try {
        const res = await fetch('/api/timesheets/entries');
        if (res.ok) {
          const data = await res.json();
          if (data.available) {
            // LIVE mode — pull entries + real team (with rates) + clients + budgets + week statuses.
            const [teamRes, clientsRes, budgetsRes, weeksRes] = await Promise.all([
              fetch('/api/timesheets/staff').then(r => r.ok ? r.json() : { members: [] }).catch(() => ({ members: [] })),
              fetch('/api/clients').then(r => r.ok ? r.json() : { clients: [] }).catch(() => ({ clients: [] })),
              fetch('/api/timesheets/budgets').then(r => r.ok ? r.json() : { budgets: {} }).catch(() => ({ budgets: {} })),
              fetch('/api/timesheets/weeks').then(r => r.ok ? r.json() : { weeks: [] }).catch(() => ({ weeks: [] })),
            ]);
            if (cancelled) return;
            setEntries(data.entries as TimeEntry[]);
            setLiveStaff(mapStaff((teamRes.members ?? []) as StaffDto[], userId, userName));
            setLiveClients(((clientsRes.clients ?? []) as { id: string; name: string; client_ref?: string }[])
              .map(c => ({ id: c.id, name: c.name, ref: c.client_ref ?? '' })));
            setClientBudgets((budgetsRes.budgets ?? {}) as Record<string, number>);
            const wmap: Record<string, WeekStatus> = {};
            for (const w of (weeksRes.weeks ?? []) as WeekStatus[]) wmap[weekKey(w.userId, w.weekStart)] = w;
            setWeekStatuses(wmap);
            setMode('live');
            setReady(true);
            return;
          }
        }
      } catch { /* network / not available → demo */ }

      if (cancelled) return;
      // DEMO mode — hydrate entries from localStorage.
      try {
        const raw = window.localStorage.getItem(demoKey);
        if (raw) {
          const d = JSON.parse(raw) as { entries?: TimeEntry[]; seeded?: boolean };
          if (d.entries) setEntries(d.entries);
          seededRef.current = d.seeded ?? !!d.entries?.length;
        }
      } catch { /* ignore */ }
      setMode('demo');
      setReady(true);
    })();

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [metaKey, demoKey]);

  // Persist meta (timer + suggestions + demo overrides + budgets + week status).
  useEffect(() => {
    if (!ready) return;
    try {
      window.localStorage.setItem(metaKey, JSON.stringify({ timer, suggestions, staffOverrides, clientBudgets, weekStatuses }));
    } catch { /* quota */ }
  }, [timer, suggestions, staffOverrides, clientBudgets, weekStatuses, ready, metaKey]);

  // Refs for synchronous lock checks inside mutations.
  const entriesRef = useRef(entries);
  entriesRef.current = entries;
  const weekStatusesRef = useRef(weekStatuses);
  weekStatusesRef.current = weekStatuses;
  const weekLockedForMe = useCallback((dateIso: string): boolean => {
    const me = modeRef.current === 'live' ? userId : ME_ID;
    const st = weekStatusesRef.current[weekKey(me, startOfWeek(dateIso))];
    return st?.status === 'submitted' || st?.status === 'approved';
  }, [userId]);

  // Persist demo entries only in demo mode.
  useEffect(() => {
    if (!ready || mode !== 'demo') return;
    try { window.localStorage.setItem(demoKey, JSON.stringify({ entries, seeded: seededRef.current })); } catch { /* quota */ }
  }, [entries, ready, mode, demoKey]);

  const timerRef = useRef(timer);
  timerRef.current = timer;

  useEffect(() => {
    if (!timer.running || timer.paused) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [timer.running, timer.paused]);

  const elapsedMs =
    timer.accumulatedMs +
    (timer.running && !timer.paused && timer.segmentStartedAt ? now - timer.segmentStartedAt : 0);

  // ── Seeding (demo mode only) ────────────────────────────────────────────────
  const ensureSeeded = useCallback(() => {
    if (modeRef.current !== 'demo' || seededRef.current) return;
    seededRef.current = true;
    const today = todayIso();
    setEntries(prev => (prev.length ? prev : generateSeedEntries(today)));
    setSuggestions(prev => (prev.length ? prev : generateDemoSuggestions(today)));
    // Seed a couple of pending approvals so the admin Approvals view is alive.
    setWeekStatuses(prev => {
      if (Object.keys(prev).length) return prev;
      const lastWeek = startOfWeek(addDays(today, -7));
      return {
        [weekKey('u-amy', lastWeek)]: { userId: 'u-amy', weekStart: lastWeek, status: 'submitted', note: null, reviewedBy: null },
        [weekKey('u-ben', lastWeek)]: { userId: 'u-ben', weekStart: lastWeek, status: 'submitted', note: null, reviewedBy: null },
      };
    });
  }, []);

  // ── Entry CRUD (mode-aware) ─────────────────────────────────────────────────
  const addEntry = useCallback((e: Omit<TimeEntry, 'id'>) => {
    if (weekLockedForMe(e.date)) return; // week submitted/approved — frozen
    const optimistic: TimeEntry = { ...e, id: tmpId(), userId: e.userId };
    setEntries(prev => [optimistic, ...prev]);
    if (modeRef.current !== 'live') return;
    fetch('/api/timesheets/entries', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entries: [e] }),
    })
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(data => {
        const saved = (data.entries?.[0]) as TimeEntry | undefined;
        if (saved) setEntries(prev => prev.map(x => (x.id === optimistic.id ? saved : x)));
      })
      .catch(() => setEntries(prev => prev.filter(x => x.id !== optimistic.id)));
  }, [weekLockedForMe]);

  const updateEntry = useCallback((id: string, patch: Partial<TimeEntry>) => {
    const ent = entriesRef.current.find(x => x.id === id);
    if (ent && (weekLockedForMe(ent.date) || (patch.date && weekLockedForMe(patch.date)))) return;
    setEntries(prev => prev.map(e => (e.id === id ? { ...e, ...patch } : e)));
    if (modeRef.current !== 'live' || id.startsWith('tmp-')) return;
    fetch(`/api/timesheets/entries/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    }).catch(() => { /* keep optimistic value */ });
  }, [weekLockedForMe]);

  const deleteEntry = useCallback((id: string) => {
    const ent = entriesRef.current.find(x => x.id === id);
    if (ent && weekLockedForMe(ent.date)) return;
    setEntries(prev => prev.filter(e => e.id !== id));
    if (modeRef.current !== 'live' || id.startsWith('tmp-')) return;
    fetch(`/api/timesheets/entries/${id}`, { method: 'DELETE' }).catch(() => { /* already removed locally */ });
  }, []);

  // ── Timer ───────────────────────────────────────────────────────────────────
  const commitTimer = useCallback((t: TimerState) => {
    const currentElapsedMs = t.accumulatedMs + (t.segmentStartedAt && !t.paused ? Date.now() - t.segmentStartedAt : 0);
    const minutes = Math.round(currentElapsedMs / 60000);
    if (minutes < 1) return;
    const meStaff = (modeRef.current === 'live' ? liveStaff : SEED_STAFF)?.find(s => s.id === (modeRef.current === 'live' ? userId : ME_ID));
    const now2 = new Date();
    const hh = String(now2.getHours()).padStart(2, '0');
    const mm = String(now2.getMinutes()).padStart(2, '0');
    addEntry({
      userId: modeRef.current === 'live' ? userId : ME_ID,
      date: todayIso(),
      start: `${hh}:${mm}`,
      clientId: t.clientId,
      clientName: t.clientName || 'Internal',
      taskId: t.taskId ?? null,
      taskTitle: t.taskTitle || t.activity,
      activity: t.activity || 'Work',
      department: t.department || 'General',
      type: t.type,
      minutes,
      ratePence: t.type === 'billable' ? (meStaff?.ratePence ?? 12000) : 0,
      notes: t.notes,
      source: 'timer',
    });
  }, [addEntry, liveStaff, userId]);

  const startTimer = useCallback((cfg: StartConfig) => {
    if (timerRef.current.running) commitTimer(timerRef.current);
    setTimer({
      running: true, paused: false, segmentStartedAt: Date.now(), accumulatedMs: 0,
      clientId: cfg.clientId, clientName: cfg.clientName, taskId: cfg.taskId ?? null, taskTitle: cfg.taskTitle,
      activity: cfg.activity, department: cfg.department, type: cfg.type, notes: cfg.notes ?? '',
    });
    setNow(Date.now());
  }, [commitTimer]);

  const pauseTimer = useCallback(() => {
    setTimer(prev => {
      if (!prev.running || prev.paused) return prev;
      const banked = prev.accumulatedMs + (prev.segmentStartedAt ? Date.now() - prev.segmentStartedAt : 0);
      return { ...prev, paused: true, accumulatedMs: banked, segmentStartedAt: null };
    });
  }, []);

  const resumeTimer = useCallback(() => {
    setTimer(prev => (prev.running && prev.paused ? { ...prev, paused: false, segmentStartedAt: Date.now() } : prev));
    setNow(Date.now());
  }, []);

  const stopTimer = useCallback((save: boolean) => {
    if (save && timerRef.current.running) commitTimer(timerRef.current);
    setTimer(emptyTimer);
  }, [commitTimer]);

  const updateTimerMeta = useCallback((patch: Partial<StartConfig>) => {
    setTimer(prev => ({ ...prev, ...patch }));
  }, []);

  // ── Sample data (live mode, fresh firm) ─────────────────────────────────────
  const loadSampleWeek = useCallback(async () => {
    if (modeRef.current !== 'live') return;
    setLoadingSample(true);
    try {
      const meStaff = liveStaff?.find(s => s.id === userId);
      const sample = generateSampleForUser(
        todayIso(), userId, meStaff?.ratePence ?? 12000,
        (liveClients ?? []).slice(0, 12).map(c => ({ id: c.id, name: c.name })),
      );
      const res = await fetch('/api/timesheets/entries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entries: sample }),
      });
      if (res.ok) {
        const data = await res.json();
        setEntries(prev => [...(data.entries as TimeEntry[]), ...prev]);
      }
    } finally {
      setLoadingSample(false);
    }
  }, [liveStaff, liveClients, userId]);

  // ── Staff rate / capacity ───────────────────────────────────────────────────
  const updateStaffRate = useCallback((id: string, patch: { ratePence?: number; weeklyCapacityHours?: number; department?: string }) => {
    if (modeRef.current === 'live') {
      setLiveStaff(prev => prev?.map(s => (s.id === id
        ? {
            ...s,
            ratePence: patch.ratePence ?? s.ratePence,
            weeklyCapacityHours: patch.weeklyCapacityHours ?? s.weeklyCapacityHours,
            department: patch.department ?? s.department,
          }
        : s)) ?? prev);
      fetch(`/api/timesheets/staff/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...(patch.ratePence !== undefined ? { ratePence: patch.ratePence } : {}),
          ...(patch.weeklyCapacityHours !== undefined ? { capacityHours: patch.weeklyCapacityHours } : {}),
          ...(patch.department !== undefined ? { department: patch.department } : {}),
        }),
      }).catch(() => { /* keep optimistic value */ });
    } else {
      setStaffOverrides(prev => ({ ...prev, [id]: { ...prev[id], ...patch } }));
    }
  }, []);

  // ── Client budgets ───────────────────────────────────────────────────────────
  const setClientBudget = useCallback((clientId: string, weeklyMinutes: number) => {
    setClientBudgets(prev => ({ ...prev, [clientId]: weeklyMinutes }));
    if (modeRef.current === 'live') {
      fetch('/api/timesheets/budgets', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId, weeklyMinutes }),
      }).catch(() => { /* keep optimistic */ });
    }
  }, []);

  // ── Week approval workflow ───────────────────────────────────────────────────
  const meIdNow = mode === 'live' ? userId : ME_ID;
  const weekStatusFor = useCallback((uid: string, weekStart: string): WeekApprovalStatus => {
    return weekStatuses[weekKey(uid, weekStart)]?.status ?? 'draft';
  }, [weekStatuses]);
  const isWeekLocked = useCallback((weekStart: string): boolean => {
    const s = weekStatuses[weekKey(meIdNow, weekStart)]?.status;
    return s === 'submitted' || s === 'approved';
  }, [weekStatuses, meIdNow]);

  const postWeek = (body: Record<string, unknown>) => {
    if (modeRef.current === 'live') {
      fetch('/api/timesheets/weeks', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      }).catch(() => { /* keep optimistic */ });
    }
  };

  const submitWeek = useCallback((weekStart: string) => {
    const uid = modeRef.current === 'live' ? userId : ME_ID;
    setWeekStatuses(prev => ({ ...prev, [weekKey(uid, weekStart)]: { userId: uid, weekStart, status: 'submitted', note: null, reviewedBy: null } }));
    postWeek({ weekStart, action: 'submit' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const withdrawWeek = useCallback((weekStart: string) => {
    const uid = modeRef.current === 'live' ? userId : ME_ID;
    setWeekStatuses(prev => {
      const next = { ...prev };
      delete next[weekKey(uid, weekStart)];
      return next;
    });
    postWeek({ weekStart, action: 'withdraw' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const reviewWeek = useCallback((uid: string, weekStart: string, action: 'approve' | 'reject', note?: string) => {
    const status: WeekApprovalStatus = action === 'approve' ? 'approved' : 'rejected';
    const reviewer = modeRef.current === 'live' ? userId : ME_ID;
    setWeekStatuses(prev => ({ ...prev, [weekKey(uid, weekStart)]: { userId: uid, weekStart, status, note: note ?? null, reviewedBy: reviewer } }));
    postWeek({ weekStart, action, userId: uid, note });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  // ── AI suggestions ───────────────────────────────────────────────────────────
  const scanForWork = useCallback(async () => {
    setScanning(true);
    try {
      const res = await fetch('/api/timesheets/suggestions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ days: 7 }),
      });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.suggestions) && data.suggestions.length) {
          setSuggestions(data.suggestions as AiSuggestion[]);
          return;
        }
      }
      // No live signals — synthesise a demo detector so the UX is visible.
      if (modeRef.current !== 'live') setSuggestions(generateDemoSuggestions(todayIso()));
      else setSuggestions([]);
    } catch {
      if (modeRef.current !== 'live') setSuggestions(generateDemoSuggestions(todayIso()));
    } finally {
      setScanning(false);
    }
  }, []);

  const acceptSuggestion = useCallback((id: string) => {
    setSuggestions(prev => {
      const s = prev.find(x => x.id === id);
      if (s) {
        const meStaff = (modeRef.current === 'live' ? liveStaff : SEED_STAFF)?.find(st => st.id === (modeRef.current === 'live' ? userId : ME_ID));
        addEntry({
          userId: modeRef.current === 'live' ? userId : ME_ID,
          date: s.date,
          start: '—',
          clientId: s.clientId,
          clientName: s.clientName,
          taskId: null,
          taskTitle: s.taskTitle,
          activity: s.activity,
          department: SEED_ACTIVITIES.find(a => a.label === s.activity)?.department ?? 'General',
          type: s.type,
          minutes: s.suggestedMinutes,
          ratePence: s.type === 'billable' ? (meStaff?.ratePence ?? 12000) : 0,
          notes: `Auto-captured from ${s.source.replace('_', ' ')}`,
          source: 'ai',
        });
      }
      return prev.filter(x => x.id !== id);
    });
  }, [addEntry, liveStaff, userId]);

  const dismissSuggestion = useCallback((id: string) => {
    setSuggestions(prev => prev.filter(x => x.id !== id));
  }, []);

  const hasSampleData = mode === 'demo' || entries.length > 0;

  const value = useMemo<TimesheetsContextValue>(() => ({
    ready, mode, allowed, userId, meId, isAdmin, entries, staff, clients, activities: SEED_ACTIVITIES,
    suggestions, scanning, hasSampleData, loadingSample, updateStaffRate, timer, elapsedMs,
    clientBudgets, setClientBudget,
    weekStatuses, weekStatusFor, isWeekLocked, submitWeek, withdrawWeek, reviewWeek,
    ensureSeeded, loadSampleWeek,
    startTimer, pauseTimer, resumeTimer, stopTimer, updateTimerMeta,
    addEntry, updateEntry, deleteEntry, scanForWork, acceptSuggestion, dismissSuggestion,
  }), [
    ready, mode, allowed, userId, meId, isAdmin, entries, staff, clients, suggestions, scanning, hasSampleData, loadingSample,
    updateStaffRate, timer, elapsedMs, clientBudgets, setClientBudget,
    weekStatuses, weekStatusFor, isWeekLocked, submitWeek, withdrawWeek, reviewWeek,
    ensureSeeded, loadSampleWeek,
    startTimer, pauseTimer, resumeTimer, stopTimer, updateTimerMeta,
    addEntry, updateEntry, deleteEntry, scanForWork, acceptSuggestion, dismissSuggestion,
  ]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
