'use client';

import {
  createContext, useContext, useCallback, useEffect, useMemo, useRef, useState, ReactNode,
} from 'react';
import type { TimeEntry, TimerState, AiSuggestion, TimeEntryType, TsClient, TsStaff, TsActivity, WeekStatus, WeekApprovalStatus } from '@/lib/timesheets/types';
import { DEPARTMENTS, DEFAULT_ACTIVITIES } from '@/lib/timesheets/defaults';
import { todayIso, startOfWeek, fmtDuration } from '@/lib/timesheets/format';

const UNDO_MS = 8000; // window to undo a just-logged timer
const DEFAULT_CAPACITY_HOURS = 37.5;
const weekKey = (userId: string, weekStart: string) => `${userId}__${weekStart}`;
// Device-local timer + suggestions (so a running timer survives a refresh).
const META_PREFIX = 'smith.timesheets.meta.';

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
  userId: string;
  meId: string;
  isAdmin: boolean;
  /** True if anyone in the firm reports to the current user (they're a manager). */
  hasReports: boolean;
  entries: TimeEntry[];
  staff: TsStaff[];
  clients: TsClient[];
  activities: TsActivity[];
  departments: string[];
  defaultRatePence: number;
  dailyTargetHours: number;
  roundingMinutes: number;
  reloadSettings: () => Promise<void>;
  suggestions: AiSuggestion[];
  scanning: boolean;
  updateStaffRate: (id: string, patch: { ratePence?: number; weeklyCapacityHours?: number; department?: string }) => void;

  // Client budgets (weekly minutes) — Budget-vs-Actual report.
  clientBudgets: Record<string, number>;
  setClientBudget: (clientId: string, weeklyMinutes: number) => void;

  // Week approval workflow.
  weekStatuses: Record<string, WeekStatus>;   // keyed `${userId}__${weekStart}`
  refreshWeeks: () => Promise<void>;           // re-pull submitted/approved weeks (e.g. new approvals)
  weekStatusFor: (userId: string, weekStart: string) => WeekApprovalStatus;
  isWeekLocked: (weekStart: string) => boolean; // for the current user
  submitWeek: (weekStart: string) => void;
  withdrawWeek: (weekStart: string) => void;
  reviewWeek: (userId: string, weekStart: string, action: 'approve' | 'reject', note?: string) => void;

  timer: TimerState;
  elapsedMs: number;

  // Brief undo window after a timer is stopped & logged.
  timerUndo: { label: string; expiresAt: number } | null;
  undoTimer: () => void;
  dismissTimerUndo: () => void;

  startTimer: (cfg: StartConfig) => void;
  pauseTimer: () => void;
  resumeTimer: () => void;
  stopTimer: (save: boolean) => void;
  updateTimerMeta: (patch: Partial<StartConfig>) => void;

  // Global "start a timer" modal — openable from anywhere (e.g. the header
  // shortcut) so time can be captured without navigating to the Timesheets tool.
  startModalOpen: boolean;
  openStartModal: () => void;
  closeStartModal: () => void;

  addEntry: (e: Omit<TimeEntry, 'id'>) => string | null;
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

interface StaffDto {
  id: string;
  full_name: string | null;
  email: string;
  role: string;
  avatar_url?: string | null;
  charge_out_rate_pence?: number | null;
  weekly_capacity_hours?: number | null;
  department?: string | null;
  manager_id?: string | null;
}

function mapStaff(members: StaffDto[], userId: string, userName: string, defaultRatePence: number): TsStaff[] {
  const rows = members.map(m => ({
    id: m.id,
    name: m.id === userId ? (userName || m.full_name || 'You') : (m.full_name || m.email?.split('@')[0] || 'Team member'),
    role: m.role === 'admin' ? 'Admin' : 'Staff',
    department: m.department || 'Unassigned',
    weeklyCapacityHours: m.weekly_capacity_hours ?? DEFAULT_CAPACITY_HOURS,
    // Firm default charge-out rate applies to anyone without their own set.
    ratePence: m.charge_out_rate_pence ?? defaultRatePence,
    hue: hashHue(m.id),
    avatarUrl: m.avatar_url ?? null,
  }));
  if (!rows.some(r => r.id === userId)) {
    rows.unshift({ id: userId, name: userName || 'You', role: 'Staff', department: 'Unassigned', weeklyCapacityHours: DEFAULT_CAPACITY_HOURS, ratePence: defaultRatePence, hue: hashHue(userId), avatarUrl: null });
  }
  return rows;
}

export default function TimesheetsProvider({
  userId, userName, userRole, children,
}: { userId: string; userName: string; userRole: string; userEmail?: string; children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [liveStaff, setLiveStaff] = useState<TsStaff[] | null>(null);
  const [liveClients, setLiveClients] = useState<TsClient[] | null>(null);
  const [hasReports, setHasReports] = useState(false);
  const [clientBudgets, setClientBudgets] = useState<Record<string, number>>({});
  const [weekStatuses, setWeekStatuses] = useState<Record<string, WeekStatus>>({});
  // Firm-configurable activities + departments (Settings → Timesheets); default
  // to the built-in lists until loaded.
  const [activities, setActivities] = useState<TsActivity[]>(DEFAULT_ACTIVITIES);
  const [departments, setDepartments] = useState<string[]>([...DEPARTMENTS]);
  const [defaultRatePence, setDefaultRatePence] = useState(12000);
  const [dailyTargetHours, setDailyTargetHours] = useState(7.5);
  const [roundingMinutes, setRoundingMinutes] = useState(15);
  const roundingRef = useRef(15);
  roundingRef.current = roundingMinutes;
  const [suggestions, setSuggestions] = useState<AiSuggestion[]>([]);
  const [timer, setTimer] = useState<TimerState>(emptyTimer);
  const [startModalOpen, setStartModalOpen] = useState(false);
  const [timerUndo, setTimerUndo] = useState<{ label: string; expiresAt: number } | null>(null);
  const undoRef = useRef<string | null>(null); // id of the last timer-logged entry (tracks tmp→real swap)
  const pendingDeleteRef = useRef<Set<string>>(new Set()); // tmp ids deleted before their POST resolved
  const [scanning, setScanning] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const metaKey = `${META_PREFIX}${userId || 'anon'}`;
  const meId = userId;
  const isAdmin = userRole === 'admin';

  const staff = useMemo<TsStaff[]>(() => (
    liveStaff ?? [{
      id: userId, name: userName || 'You', role: isAdmin ? 'Admin' : 'Staff',
      department: 'Unassigned', weeklyCapacityHours: DEFAULT_CAPACITY_HOURS, ratePence: defaultRatePence, hue: hashHue(userId),
    }]
  ), [liveStaff, userId, userName, isAdmin, defaultRatePence]);

  const clients = liveClients ?? [];

  // ── Load everything from the API ────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;

    // Device-local resume for a running timer + last suggestions.
    try {
      const raw = window.localStorage.getItem(metaKey);
      if (raw) {
        const m = JSON.parse(raw) as { timer?: TimerState; suggestions?: AiSuggestion[] };
        if (m.timer) setTimer(m.timer);
        if (m.suggestions) setSuggestions(m.suggestions);
      }
    } catch { /* ignore */ }

    (async () => {
      const [entriesRes, teamRes, clientsRes, budgetsRes, weeksRes, settingsRes] = await Promise.all([
        fetch('/api/timesheets/entries').then(r => r.ok ? r.json() : { entries: [] }).catch(() => ({ entries: [] })),
        fetch('/api/timesheets/staff').then(r => r.ok ? r.json() : { members: [] }).catch(() => ({ members: [] })),
        fetch('/api/clients').then(r => r.ok ? r.json() : { clients: [] }).catch(() => ({ clients: [] })),
        fetch('/api/timesheets/budgets').then(r => r.ok ? r.json() : { budgets: {} }).catch(() => ({ budgets: {} })),
        fetch('/api/timesheets/weeks').then(r => r.ok ? r.json() : { weeks: [] }).catch(() => ({ weeks: [] })),
        fetch('/api/timesheets/settings').then(r => r.ok ? r.json() : null).catch(() => null),
      ]);
      if (cancelled) return;

      const firmRate = Number(settingsRes?.defaultRatePence) || 12000;
      if (settingsRes) {
        if (Array.isArray(settingsRes.activities) && settingsRes.activities.length) setActivities(settingsRes.activities as TsActivity[]);
        if (Array.isArray(settingsRes.departments) && settingsRes.departments.length) setDepartments(settingsRes.departments as string[]);
        if (settingsRes.defaultRatePence != null) setDefaultRatePence(firmRate);
        if (settingsRes.dailyTargetHours != null) setDailyTargetHours(Number(settingsRes.dailyTargetHours));
        if (settingsRes.roundingMinutes != null) setRoundingMinutes(Number(settingsRes.roundingMinutes));
      }

      const members = (teamRes.members ?? []) as StaffDto[];
      setEntries((entriesRes.entries ?? []) as TimeEntry[]);
      setLiveStaff(mapStaff(members, userId, userName, firmRate));
      setHasReports(members.some(m => m.manager_id === userId));
      setLiveClients(((clientsRes.clients ?? []) as { id: string; name: string; client_ref?: string; status?: string }[])
        .map(c => ({ id: c.id, name: c.name, ref: c.client_ref ?? '', status: c.status })));
      setClientBudgets((budgetsRes.budgets ?? {}) as Record<string, number>);
      const wmap: Record<string, WeekStatus> = {};
      for (const w of (weeksRes.weeks ?? []) as WeekStatus[]) wmap[weekKey(w.userId, w.weekStart)] = w;
      setWeekStatuses(wmap);
      setReady(true);
    })();

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [metaKey]);

  // Persist timer + suggestions (device-local).
  useEffect(() => {
    if (!ready) return;
    try { window.localStorage.setItem(metaKey, JSON.stringify({ timer, suggestions })); } catch { /* quota */ }
  }, [timer, suggestions, ready, metaKey]);

  // Refs for synchronous lock checks inside mutations.
  const entriesRef = useRef(entries);
  entriesRef.current = entries;
  const weekStatusesRef = useRef(weekStatuses);
  weekStatusesRef.current = weekStatuses;
  const weekLockedForMe = useCallback((dateIso: string): boolean => {
    const st = weekStatusesRef.current[weekKey(userId, startOfWeek(dateIso))];
    return st?.status === 'submitted' || st?.status === 'approved';
  }, [userId]);

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

  // ── Entry CRUD ──────────────────────────────────────────────────────────────
  const addEntry = useCallback((e: Omit<TimeEntry, 'id'>): string | null => {
    if (weekLockedForMe(e.date)) return null; // week submitted/approved — frozen
    const optimistic: TimeEntry = { ...e, id: tmpId(), userId: e.userId };
    setEntries(prev => [optimistic, ...prev]);
    fetch('/api/timesheets/entries', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entries: [e] }),
    })
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(data => {
        const saved = (data.entries?.[0]) as TimeEntry | undefined;
        if (saved) {
          if (pendingDeleteRef.current.has(optimistic.id)) {
            // Deleted (e.g. undone) before this POST resolved — remove the row
            // the server just created and don't re-add it locally.
            pendingDeleteRef.current.delete(optimistic.id);
            fetch(`/api/timesheets/entries/${saved.id}`, { method: 'DELETE' }).catch(() => {});
          } else {
            setEntries(prev => prev.map(x => (x.id === optimistic.id ? saved : x)));
            if (undoRef.current === optimistic.id) undoRef.current = saved.id;
          }
        }
      })
      .catch(() => setEntries(prev => prev.filter(x => x.id !== optimistic.id)));
    return optimistic.id;
  }, [weekLockedForMe]);

  const updateEntry = useCallback((id: string, patch: Partial<TimeEntry>) => {
    const ent = entriesRef.current.find(x => x.id === id);
    if (ent && (weekLockedForMe(ent.date) || (patch.date && weekLockedForMe(patch.date)))) return;
    setEntries(prev => prev.map(e => (e.id === id ? { ...e, ...patch } : e)));
    if (id.startsWith('tmp-')) return; // will save with its create
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
    // Still saving — remember to delete the real row once its POST resolves.
    if (id.startsWith('tmp-')) { pendingDeleteRef.current.add(id); return; }
    fetch(`/api/timesheets/entries/${id}`, { method: 'DELETE' }).catch(() => { /* already removed locally */ });
  }, [weekLockedForMe]);

  // ── Timer ───────────────────────────────────────────────────────────────────
  const commitTimer = useCallback((t: TimerState) => {
    const currentElapsedMs = t.accumulatedMs + (t.segmentStartedAt && !t.paused ? Date.now() - t.segmentStartedAt : 0);
    const raw = Math.round(currentElapsedMs / 60000);
    if (raw < 1) return;
    const inc = Math.max(1, roundingRef.current);
    const minutes = Math.max(inc, Math.round(raw / inc) * inc);
    const meStaff = liveStaff?.find(s => s.id === userId);
    const now2 = new Date();
    const hh = String(now2.getHours()).padStart(2, '0');
    const mm = String(now2.getMinutes()).padStart(2, '0');
    const id = addEntry({
      userId,
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
      ratePence: t.type === 'billable' ? (meStaff?.ratePence ?? defaultRatePence) : 0,
      notes: t.notes,
      source: 'timer',
    });
    if (id) {
      undoRef.current = id;
      setTimerUndo({ label: `${t.clientName || 'Internal'} · ${fmtDuration(minutes)}`, expiresAt: Date.now() + UNDO_MS });
    }
  }, [addEntry, liveStaff, userId, defaultRatePence]);

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

  // Auto-dismiss the undo toast when its window elapses.
  useEffect(() => {
    if (!timerUndo) return;
    const id = window.setTimeout(() => setTimerUndo(null), Math.max(0, timerUndo.expiresAt - Date.now()));
    return () => window.clearTimeout(id);
  }, [timerUndo]);

  const undoTimer = useCallback(() => {
    if (undoRef.current) deleteEntry(undoRef.current);
    undoRef.current = null;
    setTimerUndo(null);
  }, [deleteEntry]);

  const dismissTimerUndo = useCallback(() => {
    undoRef.current = null;
    setTimerUndo(null);
  }, []);

  // ── Staff rate / capacity / department ──────────────────────────────────────
  const updateStaffRate = useCallback((id: string, patch: { ratePence?: number; weeklyCapacityHours?: number; department?: string }) => {
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
  }, []);

  // ── Client budgets ──────────────────────────────────────────────────────────
  const setClientBudget = useCallback((clientId: string, weeklyMinutes: number) => {
    setClientBudgets(prev => ({ ...prev, [clientId]: weeklyMinutes }));
    fetch('/api/timesheets/budgets', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId, weeklyMinutes }),
    }).catch(() => { /* keep optimistic */ });
  }, []);

  // Re-pull firm activities/departments/defaults after they're edited in Settings.
  const reloadSettings = useCallback(async () => {
    try {
      const res = await fetch('/api/timesheets/settings');
      if (!res.ok) return;
      const d = await res.json();
      if (Array.isArray(d.activities) && d.activities.length) setActivities(d.activities as TsActivity[]);
      if (Array.isArray(d.departments) && d.departments.length) setDepartments(d.departments as string[]);
      if (d.defaultRatePence != null) setDefaultRatePence(Number(d.defaultRatePence));
      if (d.dailyTargetHours != null) setDailyTargetHours(Number(d.dailyTargetHours));
      if (d.roundingMinutes != null) setRoundingMinutes(Number(d.roundingMinutes));
    } catch { /* ignore */ }
  }, []);

  // ── Week approval workflow ──────────────────────────────────────────────────
  // Re-pull week statuses on demand. Workspace tabs stay mounted (display:none),
  // so the one-time load on mount can go stale — e.g. a teammate submits a week
  // hours after this tab was opened. Refetch on focus and when Approvals opens so
  // pending approvals actually appear without a hard refresh.
  const loadWeeks = useCallback(async () => {
    try {
      const res = await fetch('/api/timesheets/weeks');
      if (!res.ok) return;
      const d = await res.json();
      const wmap: Record<string, WeekStatus> = {};
      for (const w of (d.weeks ?? []) as WeekStatus[]) wmap[weekKey(w.userId, w.weekStart)] = w;
      setWeekStatuses(wmap);
    } catch { /* keep current */ }
  }, []);

  // Refetch when the app regains focus / becomes visible again.
  useEffect(() => {
    if (!ready) return;
    const onVisible = () => { if (document.visibilityState === 'visible') void loadWeeks(); };
    window.addEventListener('focus', onVisible);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('focus', onVisible);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [ready, loadWeeks]);

  const weekStatusFor = useCallback((uid: string, weekStart: string): WeekApprovalStatus => {
    return weekStatuses[weekKey(uid, weekStart)]?.status ?? 'draft';
  }, [weekStatuses]);
  const isWeekLocked = useCallback((weekStart: string): boolean => {
    const s = weekStatuses[weekKey(userId, weekStart)]?.status;
    return s === 'submitted' || s === 'approved';
  }, [weekStatuses, userId]);

  const postWeek = (body: Record<string, unknown>) => {
    fetch('/api/timesheets/weeks', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    }).catch(() => { /* keep optimistic */ });
  };

  const submitWeek = useCallback((weekStart: string) => {
    setWeekStatuses(prev => ({ ...prev, [weekKey(userId, weekStart)]: { userId, weekStart, status: 'submitted', note: null, reviewedBy: null, managerId: prev[weekKey(userId, weekStart)]?.managerId ?? null } }));
    postWeek({ weekStart, action: 'submit' });
  }, [userId]);

  const withdrawWeek = useCallback((weekStart: string) => {
    setWeekStatuses(prev => {
      const next = { ...prev };
      delete next[weekKey(userId, weekStart)];
      return next;
    });
    postWeek({ weekStart, action: 'withdraw' });
  }, [userId]);

  const reviewWeek = useCallback((uid: string, weekStart: string, action: 'approve' | 'reject', note?: string) => {
    const status: WeekApprovalStatus = action === 'approve' ? 'approved' : 'rejected';
    setWeekStatuses(prev => ({ ...prev, [weekKey(uid, weekStart)]: { userId: uid, weekStart, status, note: note ?? null, reviewedBy: userId, managerId: prev[weekKey(uid, weekStart)]?.managerId ?? null } }));
    postWeek({ weekStart, action, userId: uid, note });
  }, [userId]);

  // ── AI suggestions ──────────────────────────────────────────────────────────
  const scanForWork = useCallback(async () => {
    setScanning(true);
    try {
      const res = await fetch('/api/timesheets/suggestions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ days: 7 }),
      });
      const data = res.ok ? await res.json() : { suggestions: [] };
      setSuggestions(Array.isArray(data.suggestions) ? (data.suggestions as AiSuggestion[]) : []);
    } catch {
      setSuggestions([]);
    } finally {
      setScanning(false);
    }
  }, []);

  const acceptSuggestion = useCallback((id: string) => {
    setSuggestions(prev => {
      const s = prev.find(x => x.id === id);
      if (s) {
        const meStaff = liveStaff?.find(st => st.id === userId);
        addEntry({
          userId,
          date: s.date,
          start: '—',
          clientId: s.clientId,
          clientName: s.clientName,
          taskId: null,
          taskTitle: s.taskTitle,
          activity: s.activity,
          department: activities.find(a => a.label === s.activity)?.department ?? 'General',
          type: s.type,
          minutes: s.suggestedMinutes,
          ratePence: s.type === 'billable' ? (meStaff?.ratePence ?? defaultRatePence) : 0,
          notes: `Auto-captured from ${s.source.replace('_', ' ')}`,
          source: 'ai',
        });
      }
      return prev.filter(x => x.id !== id);
    });
  }, [addEntry, liveStaff, userId, activities, defaultRatePence]);

  const dismissSuggestion = useCallback((id: string) => {
    setSuggestions(prev => prev.filter(x => x.id !== id));
  }, []);

  const openStartModal = useCallback(() => setStartModalOpen(true), []);
  const closeStartModal = useCallback(() => setStartModalOpen(false), []);

  const value = useMemo<TimesheetsContextValue>(() => ({
    ready, userId, meId, isAdmin, hasReports, entries, staff, clients, activities, departments,
    defaultRatePence, dailyTargetHours, roundingMinutes, reloadSettings,
    suggestions, scanning, updateStaffRate, timer, elapsedMs,
    timerUndo, undoTimer, dismissTimerUndo, clientBudgets, setClientBudget,
    weekStatuses, refreshWeeks: loadWeeks, weekStatusFor, isWeekLocked, submitWeek, withdrawWeek, reviewWeek,
    startTimer, pauseTimer, resumeTimer, stopTimer, updateTimerMeta,
    startModalOpen, openStartModal, closeStartModal,
    addEntry, updateEntry, deleteEntry, scanForWork, acceptSuggestion, dismissSuggestion,
  }), [
    ready, userId, meId, isAdmin, hasReports, entries, staff, clients, activities, departments,
    defaultRatePence, dailyTargetHours, roundingMinutes, reloadSettings,
    suggestions, scanning, updateStaffRate, timer, elapsedMs,
    timerUndo, undoTimer, dismissTimerUndo, clientBudgets, setClientBudget,
    weekStatuses, loadWeeks, weekStatusFor, isWeekLocked, submitWeek, withdrawWeek, reviewWeek,
    startTimer, pauseTimer, resumeTimer, stopTimer, updateTimerMeta,
    startModalOpen, openStartModal, closeStartModal,
    addEntry, updateEntry, deleteEntry, scanForWork, acceptSuggestion, dismissSuggestion,
  ]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
