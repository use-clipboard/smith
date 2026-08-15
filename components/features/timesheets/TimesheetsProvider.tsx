'use client';

import {
  createContext, useContext, useCallback, useEffect, useMemo, useRef, useState, ReactNode,
} from 'react';
import type { TimeEntry, TimerState, TimerInstance, AiSuggestion, TimeEntryType, TsClient, TsStaff, TsActivity, WeekStatus, WeekApprovalStatus } from '@/lib/timesheets/types';
import { MAX_TIMERS } from '@/lib/timesheets/types';
import { DEPARTMENTS, DEFAULT_ACTIVITIES } from '@/lib/timesheets/defaults';
import { toIsoDate, startOfWeek, fmtDuration } from '@/lib/timesheets/format';
import { nextTimerColor, TIMER_COLORS } from '@/lib/timesheets/palette';
import { BADGE_REFRESH_EVENT } from '@/lib/notificationTarget';

const UNDO_MS = 8000; // window to undo a just-logged timer
const DEFAULT_CAPACITY_HOURS = 37.5;
const weekKey = (userId: string, weekStart: string) => `${userId}__${weekStart}`;
// Device-local timer + suggestions (so a running timer survives a refresh).
const META_PREFIX = 'smith.timesheets.meta.';
// Heartbeat — the last epoch ms the app was alive with a timer running. Written
// every second while counting; read on load to tell a genuine refresh apart from
// a timer left running while SMITH/the PC was closed. See reconcileLoadedTimers.
const HB_PREFIX = 'smith.timesheets.hb.';
// A still-"running" timer whose last heartbeat is older than this is treated as
// stale (the app wasn't open, so the intervening time wasn't worked). Comfortably
// above the ~60s interval a backgrounded tab's setInterval is throttled to.
const STALE_TIMER_MS = 2 * 60 * 1000;

interface StartConfig {
  clientId: string | null;
  clientName: string;
  taskId?: string | null;
  taskTitle: string;
  activity: string;
  department: string;
  type: TimeEntryType;
  notes?: string;
  /** Optional display name + colour for the floating timer card. */
  label?: string;
  color?: string;
}

type TimerMetaPatch = Partial<StartConfig>;

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
  /** Clear a week's status back to draft from any state (incl. approved). */
  reopenWeek: (weekStart: string) => void;
  reviewWeek: (userId: string, weekStart: string, action: 'approve' | 'reject', note?: string) => void;

  // Up to MAX_TIMERS concurrent timers; only one ever runs (unpaused) at a time.
  timers: TimerInstance[];
  /** Live epoch ms, ticked each second while a timer runs — for elapsed calc. */
  nowMs: number;
  /** False once MAX_TIMERS are open (stop one to start another). */
  canAddTimer: boolean;

  // Brief undo window after a timer is stopped & logged.
  timerUndo: { label: string; expiresAt: number } | null;
  undoTimer: () => void;
  dismissTimerUndo: () => void;

  /** Set on load when a timer was auto-paused because it had been left running
   *  while the app/PC was closed — a dismissible notice for the user. */
  staleTimerNotice: string | null;
  dismissStaleTimerNotice: () => void;

  /** Start a new timer (pauses any running one). No-op when MAX_TIMERS are open. */
  startTimer: (cfg: StartConfig) => void;
  pauseTimer: (id: string) => void;
  /** Resume a paused timer — pauses whichever timer was running first. */
  resumeTimer: (id: string) => void;
  stopTimer: (id: string, save: boolean) => void;
  updateTimerMeta: (id: string, patch: TimerMetaPatch) => void;

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

const tmpTimerId = () => `t-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

/** On load, a timer persisted as `running` keeps counting `now - segmentStartedAt`
 *  — which silently bills every hour the app/PC was closed. Reconcile against the
 *  last heartbeat: if the app wasn't alive within STALE_TIMER_MS of `now`, bank
 *  only the time up to when we last saw it alive and pause the timer, so the user
 *  decides whether to resume or Stop & log rather than losing/inflating the entry.
 *  Normal refreshes (a tiny gap) pass through untouched and keep running. When
 *  there's no heartbeat yet (a timer from before this shipped), fall back to the
 *  segment's own start so a just-started timer still survives a reload. */
function reconcileLoadedTimers(
  list: TimerInstance[], hbTs: number | null, now: number,
): { timers: TimerInstance[]; pausedCount: number } {
  let pausedCount = 0;
  const timers = list.map(t => {
    if (!t.running || t.paused || !t.segmentStartedAt) return t;
    const lastAlive = hbTs ?? t.segmentStartedAt;
    if (now - lastAlive <= STALE_TIMER_MS) return t;
    pausedCount += 1;
    const liveMs = Math.max(0, lastAlive - t.segmentStartedAt);
    return { ...t, paused: true, accumulatedMs: t.accumulatedMs + liveMs, segmentStartedAt: null };
  });
  return { timers, pausedCount };
}

/** Bank a running timer's elapsed time and pause it (no-op if already paused). */
function pauseInstance(t: TimerInstance): TimerInstance {
  if (t.paused) return t;
  return {
    ...t,
    paused: true,
    accumulatedMs: t.accumulatedMs + (t.segmentStartedAt ? Date.now() - t.segmentStartedAt : 0),
    segmentStartedAt: null,
  };
}

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
  const [timers, setTimers] = useState<TimerInstance[]>([]);
  const [startModalOpen, setStartModalOpen] = useState(false);
  const [timerUndo, setTimerUndo] = useState<{ label: string; expiresAt: number } | null>(null);
  const [staleTimerNotice, setStaleTimerNotice] = useState<string | null>(null);
  const dismissStaleTimerNotice = useCallback(() => setStaleTimerNotice(null), []);
  const undoRef = useRef<string | null>(null); // id of the last timer-logged entry (tracks tmp→real swap)
  const pendingDeleteRef = useRef<Set<string>>(new Set()); // tmp ids deleted before their POST resolved
  const lastWrittenRef = useRef<string | null>(null); // last blob this tab persisted (see the storage listener)
  const [scanning, setScanning] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const metaKey = `${META_PREFIX}${userId || 'anon'}`;
  const hbKey = `${HB_PREFIX}${userId || 'anon'}`;
  const meId = userId;
  const isAdmin = userRole === 'admin';

  const staff = useMemo<TsStaff[]>(() => (
    liveStaff ?? [{
      id: userId, name: userName || 'You', role: isAdmin ? 'Admin' : 'Staff',
      department: 'Unassigned', weeklyCapacityHours: DEFAULT_CAPACITY_HOURS, ratePence: defaultRatePence, hue: hashHue(userId),
    }]
  ), [liveStaff, userId, userName, isAdmin, defaultRatePence]);

  const clients = useMemo<TsClient[]>(() => liveClients ?? [], [liveClients]);

  // ── Load everything from the API ────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;

    // Device-local resume for running timers + last suggestions.
    try {
      const raw = window.localStorage.getItem(metaKey);
      if (raw) {
        const m = JSON.parse(raw) as { timers?: TimerInstance[]; timer?: TimerState; suggestions?: AiSuggestion[] };
        let hbTs: number | null = null;
        try { const h = window.localStorage.getItem(hbKey); if (h) hbTs = Number(h) || null; } catch { /* ignore */ }
        let restored: TimerInstance[] = [];
        if (Array.isArray(m.timers)) {
          restored = m.timers.slice(0, MAX_TIMERS);
        } else if (m.timer && (m.timer.running || m.timer.accumulatedMs > 0)) {
          // Migrate the old single-timer shape into the new array.
          restored = [{ ...m.timer, id: tmpTimerId(), label: '', color: TIMER_COLORS[0] }];
        }
        // Don't trust a "running" timer's elapsed across an app/PC restart —
        // pause any that were left running while SMITH was closed (see helper).
        const { timers: reconciled, pausedCount } = reconcileLoadedTimers(restored, hbTs, Date.now());
        setTimers(reconciled);
        if (pausedCount > 0) {
          setStaleTimerNotice(
            pausedCount === 1
              ? 'A timer was left running while SMITH was closed. We paused it and kept the time up to when you last had SMITH open — review it, then Stop & log or resume.'
              : `${pausedCount} timers were left running while SMITH was closed. We paused them and kept the time up to when you last had SMITH open — review them, then Stop & log or resume.`,
          );
        }
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

  // Persist timers + suggestions (device-local).
  useEffect(() => {
    if (!ready) return;
    const serialised = JSON.stringify({ timers, suggestions });
    if (serialised === lastWrittenRef.current) return; // unchanged — don't wake other tabs
    lastWrittenRef.current = serialised;
    try { window.localStorage.setItem(metaKey, serialised); } catch { /* quota */ }
  }, [timers, suggestions, ready, metaKey]);

  // Adopt timers/suggestions changed by another tab. Every tab mounts this
  // provider (it lives in AppShell) and each writes the whole blob, so without
  // this a tab holding stale state would overwrite a timer another tab is
  // running — losing time that was never logged, or resurrecting a stopped
  // timer so its work gets billed twice.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== metaKey || !e.newValue) return;
      let m: { timers?: TimerInstance[]; suggestions?: AiSuggestion[] };
      try { m = JSON.parse(e.newValue); } catch { return; }
      // Remember what we adopted before applying it, so the persist effect above
      // sees no change and stays quiet. Otherwise each tab's adoption would
      // trigger a write back to the other, and they'd write to each other
      // indefinitely.
      lastWrittenRef.current = e.newValue;
      setTimers(Array.isArray(m.timers) ? m.timers.slice(0, MAX_TIMERS) : []);
      setSuggestions(Array.isArray(m.suggestions) ? m.suggestions : []);
      setNow(Date.now());
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [metaKey]);

  // Refs for synchronous lock checks inside mutations.
  const entriesRef = useRef(entries);
  entriesRef.current = entries;
  const weekStatusesRef = useRef(weekStatuses);
  weekStatusesRef.current = weekStatuses;
  // Clear a week's status back to draft (from any state, incl. approved).
  const reopenWeek = useCallback((weekStart: string) => {
    const key = weekKey(userId, weekStart);
    setWeekStatuses(prev => {
      if (!prev[key]) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
    fetch('/api/timesheets/weeks', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ weekStart, action: 'reopen' }),
    }).catch(() => { /* keep optimistic */ });
  }, [userId]);

  // Approval is a checkpoint, not a freeze: editing a submitted/approved week
  // reopens it to draft so the user is never blocked mid-week. They resubmit and
  // the manager re-approves.
  const reopenWeekIfNeeded = useCallback((dateIso: string) => {
    const ws = startOfWeek(dateIso);
    const st = weekStatusesRef.current[weekKey(userId, ws)]?.status;
    if (st === 'submitted' || st === 'approved') reopenWeek(ws);
  }, [userId, reopenWeek]);

  const timersRef = useRef(timers);
  timersRef.current = timers;

  const anyRunning = timers.some(t => t.running && !t.paused);
  useEffect(() => {
    if (!anyRunning) return;
    // Stamp a heartbeat each tick so a reload can tell "still here" from "the app
    // was closed and this time wasn't worked" (reconcileLoadedTimers reads it).
    const stamp = () => { try { window.localStorage.setItem(hbKey, String(Date.now())); } catch { /* quota */ } };
    stamp();
    const id = window.setInterval(() => { setNow(Date.now()); stamp(); }, 1000);
    return () => window.clearInterval(id);
  }, [anyRunning, hbKey]);

  // Final heartbeat when the tab/PC closes, so the last-alive stamp is as fresh
  // as possible (an abrupt power-off can't fire this — the 1s tick covers that).
  useEffect(() => {
    const onHide = () => {
      if (!timersRef.current.some(t => t.running && !t.paused)) return;
      try { window.localStorage.setItem(hbKey, String(Date.now())); } catch { /* quota */ }
    };
    window.addEventListener('pagehide', onHide);
    document.addEventListener('visibilitychange', onHide);
    return () => {
      window.removeEventListener('pagehide', onHide);
      document.removeEventListener('visibilitychange', onHide);
    };
  }, [hbKey]);

  const canAddTimer = timers.length < MAX_TIMERS;

  // ── Entry CRUD ──────────────────────────────────────────────────────────────
  const addEntry = useCallback((e: Omit<TimeEntry, 'id'>): string | null => {
    reopenWeekIfNeeded(e.date); // editing an approved/submitted week reopens it
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
  }, [reopenWeekIfNeeded]);

  const updateEntry = useCallback((id: string, patch: Partial<TimeEntry>) => {
    const ent = entriesRef.current.find(x => x.id === id);
    if (ent) reopenWeekIfNeeded(ent.date);
    if (patch.date) reopenWeekIfNeeded(patch.date);
    setEntries(prev => prev.map(e => (e.id === id ? { ...e, ...patch } : e)));
    if (id.startsWith('tmp-')) return; // will save with its create
    fetch(`/api/timesheets/entries/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    }).catch(() => { /* keep optimistic value */ });
  }, [reopenWeekIfNeeded]);

  const deleteEntry = useCallback((id: string) => {
    const ent = entriesRef.current.find(x => x.id === id);
    if (ent) reopenWeekIfNeeded(ent.date);
    setEntries(prev => prev.filter(e => e.id !== id));
    // Still saving — remember to delete the real row once its POST resolves.
    if (id.startsWith('tmp-')) { pendingDeleteRef.current.add(id); return; }
    fetch(`/api/timesheets/entries/${id}`, { method: 'DELETE' }).catch(() => { /* already removed locally */ });
  }, [reopenWeekIfNeeded]);

  // ── Timer ───────────────────────────────────────────────────────────────────
  const commitTimer = useCallback((t: TimerState) => {
    const currentElapsedMs = t.accumulatedMs + (t.segmentStartedAt && !t.paused ? Date.now() - t.segmentStartedAt : 0);
    const raw = Math.round(currentElapsedMs / 60000);
    if (raw < 1) return;
    const inc = Math.max(1, roundingRef.current);
    const minutes = Math.max(inc, Math.round(raw / inc) * inc);
    const meStaff = liveStaff?.find(s => s.id === userId);
    // Log against when the timer was first started, not when it was stopped.
    // Timers persisted before firstStartedAt existed fall back to working the
    // start back from the elapsed time.
    const startedAt = new Date(t.firstStartedAt ?? (Date.now() - currentElapsedMs));
    const hh = String(startedAt.getHours()).padStart(2, '0');
    const mm = String(startedAt.getMinutes()).padStart(2, '0');
    const id = addEntry({
      userId,
      date: toIsoDate(startedAt),
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

  // Start a new timer. Pauses whichever timer was running (only one counts at a
  // time) and adds the new one. No-op when MAX_TIMERS are already open.
  const startTimer = useCallback((cfg: StartConfig) => {
    setTimers(prev => {
      if (prev.length >= MAX_TIMERS) return prev;
      const paused = prev.map(pauseInstance);
      const inst: TimerInstance = {
        id: tmpTimerId(),
        label: cfg.label?.trim() || cfg.clientName || cfg.activity || 'Timer',
        color: cfg.color || nextTimerColor(prev.map(t => t.color)),
        running: true, paused: false, firstStartedAt: Date.now(), segmentStartedAt: Date.now(), accumulatedMs: 0,
        clientId: cfg.clientId, clientName: cfg.clientName, taskId: cfg.taskId ?? null, taskTitle: cfg.taskTitle,
        activity: cfg.activity, department: cfg.department, type: cfg.type, notes: cfg.notes ?? '',
      };
      return [...paused, inst];
    });
    setNow(Date.now());
  }, []);

  const pauseTimer = useCallback((id: string) => {
    setTimers(prev => prev.map(t => (t.id === id ? pauseInstance(t) : t)));
  }, []);

  // Resume a paused timer, pausing whichever one was running so only one counts.
  const resumeTimer = useCallback((id: string) => {
    setTimers(prev => prev.map(t => (
      t.id === id ? { ...t, paused: false, segmentStartedAt: Date.now() } : pauseInstance(t)
    )));
    setNow(Date.now());
  }, []);

  const stopTimer = useCallback((id: string, save: boolean) => {
    const t = timersRef.current.find(x => x.id === id);
    if (t && save) commitTimer(t);
    setTimers(prev => prev.filter(x => x.id !== id));
  }, [commitTimer]);

  const updateTimerMeta = useCallback((id: string, patch: TimerMetaPatch) => {
    setTimers(prev => prev.map(t => (t.id === id ? { ...t, ...patch } : t)));
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
    // Realtime: a timesheet approval/submission notification (or any in-tool
    // action) fires badge-refresh → re-pull week statuses so the Approvals marker
    // updates live instead of only on focus.
    const onBadge = () => void loadWeeks();
    window.addEventListener('focus', onVisible);
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener(BADGE_REFRESH_EVENT, onBadge);
    return () => {
      window.removeEventListener('focus', onVisible);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener(BADGE_REFRESH_EVENT, onBadge);
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
    const key = weekKey(userId, weekStart);
    setWeekStatuses(prev => ({ ...prev, [key]: { userId, weekStart, status: 'submitted', note: null, reviewedBy: null, managerId: prev[key]?.managerId ?? null } }));
    // A user with no manager is auto-approved server-side — reflect that instead
    // of leaving the optimistic "submitted" (otherwise it looks stuck awaiting
    // an approval that will never come).
    fetch('/api/timesheets/weeks', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ weekStart, action: 'submit' }),
    })
      .then(r => (r.ok ? r.json() : null))
      .then(d => {
        if (d?.status === 'approved') {
          setWeekStatuses(prev => ({ ...prev, [key]: { userId, weekStart, status: 'approved', note: null, reviewedBy: null, managerId: prev[key]?.managerId ?? null } }));
        }
      })
      .catch(() => { /* keep optimistic */ });
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
    suggestions, scanning, updateStaffRate, timers, nowMs: now, canAddTimer,
    timerUndo, undoTimer, dismissTimerUndo, staleTimerNotice, dismissStaleTimerNotice,
    clientBudgets, setClientBudget,
    weekStatuses, refreshWeeks: loadWeeks, weekStatusFor, isWeekLocked, submitWeek, withdrawWeek, reopenWeek, reviewWeek,
    startTimer, pauseTimer, resumeTimer, stopTimer, updateTimerMeta,
    startModalOpen, openStartModal, closeStartModal,
    addEntry, updateEntry, deleteEntry, scanForWork, acceptSuggestion, dismissSuggestion,
  }), [
    ready, userId, meId, isAdmin, hasReports, entries, staff, clients, activities, departments,
    defaultRatePence, dailyTargetHours, roundingMinutes, reloadSettings,
    suggestions, scanning, updateStaffRate, timers, now, canAddTimer,
    timerUndo, undoTimer, dismissTimerUndo, staleTimerNotice, dismissStaleTimerNotice,
    clientBudgets, setClientBudget,
    weekStatuses, loadWeeks, weekStatusFor, isWeekLocked, submitWeek, withdrawWeek, reopenWeek, reviewWeek,
    startTimer, pauseTimer, resumeTimer, stopTimer, updateTimerMeta,
    startModalOpen, openStartModal, closeStartModal,
    addEntry, updateEntry, deleteEntry, scanForWork, acceptSuggestion, dismissSuggestion,
  ]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
