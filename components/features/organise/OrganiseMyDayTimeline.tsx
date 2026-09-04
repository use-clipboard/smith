'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, CalendarClock, MoveRight, RotateCcw, Plus, X, PlayCircle, Clock3, AlertTriangle, PauseCircle, Loader2, GripVertical, Pencil, Link2, CalendarPlus, CalendarCheck, Lock, Users } from 'lucide-react';
import { buildDayPlan, TIER_META, CHASE_COLOR } from '@/lib/tasks/dayPlan';
import OrganiseMyDayBlockEditor from './OrganiseMyDayBlockEditor';
import Tooltip from '@/components/ui/Tooltip';
import { todayIso } from '@/lib/timesheets/format';
import type { OrganiseSettings } from '@/lib/tasks/organiseSettings';
import type { Task } from '@/types';

const clientLabel = (t: Task) => t.is_internal ? 'Internal'
  : `${t.client?.name ?? '—'}${t.client?.client_ref ? ` · ${t.client.client_ref}` : ''}`;

// The day-planner. Admin quick-wins + the user's tasks scheduled into their
// working hours AROUND calendar meetings, lunch and an end-of-day wrap, from now.
// The plan is PERSISTED per day: it survives refreshes; completed work drops off
// automatically; "Re-plan" is the only thing that regenerates and pulls in new
// work. Hand-editable (drag / resize / insert). All layout stored as blocks.

const PX_PER_HOUR = 68;
const SNAP = 15;
const MOVABLE_MIN = 30;   // shortest a task/admin/custom block can be (keeps actions usable)

export interface AdminItem { key: string; label: string; count: number; minutes: number; color: string; onOpen: () => void }
interface Busy { start: number; end: number }
interface PlanItem { id: string; kind: 'admin' | 'task' | 'chase'; label: string; sub?: string; minutes: number; color: string; task?: Task; onOpen: () => void; onDone?: () => void }
/** Persisted block: identifies a queue item (by key) or a custom focus block. */
interface Block { key: string; kind: 'admin' | 'task' | 'chase' | 'custom' | 'break' | 'wrap'; start: number; dur: number; label?: string; color?: string; taskId?: string | null; taskTitle?: string | null; clientName?: string | null }
type DragState = { key: string; mode: 'move' | 'resize'; deltaMin: number } | null;
/** Persisted calendar-sync state: which Google event each block maps to + chosen visibility. */
interface CalSync { eventIds: Record<string, string>; visibility: 'private' | 'shared'; sig: string }

const minToHHMM = (m: number): string => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(Math.round(m) % 60).padStart(2, '0')}`;
const parseMin = (hhmm: string): number => { const [h, m] = (hhmm || '').split(':').map(Number); return (h || 0) * 60 + (m || 0); };
function fmtDur(min: number): string { const h = Math.floor(min / 60), m = min % 60; return h ? (m ? `${h}h ${m}m` : `${h}h`) : `${m}m`; }

function estimateMinutes(t: Task): number {
  const remaining = (t.steps ?? []).filter(s => !s.is_client_step && s.status !== 'complete' && s.status !== 'skipped').length;
  return Math.min(Math.max(remaining * 25, 30), 180);
}

interface CalEvent { id: string; title: string; startHHmm: string; minutes: number }

function findSlot(from: number, dur: number, busy: Busy[], workStart: number, workEnd: number): number | null {
  let start = Math.max(from, workStart);
  for (let g = 0; g < 400; g++) {
    if (start + dur > workEnd) return null;
    const clash = busy.find(b => start < b.end && start + dur > b.start);
    if (!clash) return start;
    start = Math.ceil(clash.end / SNAP) * SNAP;
  }
  return null;
}

interface Props {
  tasks: Task[];
  userId: string;
  adminItems: AdminItem[];
  settings: OrganiseSettings;
  onOpenTask: (t: Task) => void;
  onMarkDone: (id: string) => void;
  onOpenTasks: () => void;
}

export default function OrganiseMyDayTimeline({ tasks, userId, adminItems, settings, onOpenTask, onMarkDone, onOpenTasks }: Props) {
  const planDate = useMemo(() => todayIso(), []);
  const [calEvents, setCalEvents] = useState<CalEvent[]>([]);
  const [calLoaded, setCalLoaded] = useState(false);
  const [planLoaded, setPlanLoaded] = useState(false);
  const [blocks, setBlocks] = useState<Block[] | null>(null);   // null = not decided yet
  const [drag, setDrag] = useState<DragState>(null);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [calConnected, setCalConnected] = useState(false);
  const [cal, setCal] = useState<CalSync | null>(null);
  const [visibility, setVisibility] = useState<'private' | 'shared'>('private');
  const [syncing, setSyncing] = useState(false);
  const [syncErr, setSyncErr] = useState<string | null>(null);
  const calRef = useRef<CalSync | null>(null);
  useEffect(() => { calRef.current = cal; }, [cal]);
  const customSeq = useRef(0);
  const didGenerate = useRef(false);
  const openMin = useMemo(() => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); }, []);
  const [nowMin, setNowMin] = useState(openMin);
  useEffect(() => {
    const id = setInterval(() => { const d = new Date(); setNowMin(d.getHours() * 60 + d.getMinutes()); }, 30_000);
    return () => clearInterval(id);
  }, []);

  // Live work queue: admin quick-wins → task tiers → one chase block.
  const { queue, waitingCount, chaseCount } = useMemo(() => {
    const plan = buildDayPlan(tasks, userId);
    const q: PlanItem[] = [];
    for (const a of adminItems) if (a.count > 0) q.push({ id: `admin-${a.key}`, kind: 'admin', label: a.label, sub: `${a.count}`, minutes: a.minutes, color: a.color, onOpen: a.onOpen });
    for (const m of TIER_META) for (const t of plan.tierTasks[m.tier]) q.push({ id: t.id, kind: 'task', label: t.title, sub: clientLabel(t), minutes: estimateMinutes(t), color: m.color, task: t, onOpen: () => onOpenTask(t), onDone: () => onMarkDone(t.id) });
    if (plan.chase.length > 0) q.push({ id: 'chase', kind: 'chase', label: 'Investigate / chase overdue', sub: `${plan.chase.length} overdue`, minutes: Math.min(45, 15 + plan.chase.length * 2), color: CHASE_COLOR, onOpen: onOpenTasks });
    return { queue: q, waitingCount: plan.waiting.length, chaseCount: plan.chase.length };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks, userId, adminItems]);
  const queueById = useMemo(() => new Map(queue.map(q => [q.id, q])), [queue]);

  // Fetch calendar + the saved plan for today.
  useEffect(() => {
    let live = true;
    fetch('/api/calendar/status').then(r => (r.ok ? r.json() : { connected: false })).then(d => {
      if (!live) return;
      if (!d?.connected) { setCalLoaded(true); return; }
      setCalConnected(true);
      fetch(`/api/timesheets/calendar?date=${planDate}`).then(r => (r.ok ? r.json() : { events: [] })).then(cd => { if (live) { setCalEvents((cd.events ?? []) as CalEvent[]); setCalLoaded(true); } }).catch(() => { if (live) setCalLoaded(true); });
    }).catch(() => { if (live) setCalLoaded(true); });
    fetch(`/api/users/organise-plan?date=${planDate}`).then(r => (r.ok ? r.json() : null)).then((d: { plan?: { blocks?: Block[]; calendar?: CalSync } | null } | null) => {
      if (!live) return;
      if (d?.plan?.blocks) { setBlocks(d.plan.blocks); didGenerate.current = true; }
      if (d?.plan?.calendar) { setCal(d.plan.calendar); calRef.current = d.plan.calendar; setVisibility(d.plan.calendar.visibility); }
      setPlanLoaded(true);
    }).catch(() => { if (live) setPlanLoaded(true); });
    return () => { live = false; };
  }, [planDate]);

  // Display range covers the working day + any meeting outside it.
  const { events, dispStart, dispEnd } = useMemo(() => {
    const events = calEvents.map(e => ({ ...e, start: parseMin(e.startHHmm), end: parseMin(e.startHHmm) + e.minutes })).filter(e => e.minutes > 0);
    const mins = [settings.workStartMin, settings.workEndMin, ...events.flatMap(e => [e.start, e.end])];
    return { events, dispStart: Math.floor(Math.min(...mins) / 60) * 60, dispEnd: Math.ceil(Math.max(...mins) / 60) * 60 };
  }, [calEvents, settings]);

  // Calendar meetings are the only truly-fixed obstacles; lunch + wrap are now
  // editable blocks that the plan places AROUND meetings.
  const calBusy = useMemo<Busy[]>(() => events.map(e => ({ start: e.start, end: e.end })).sort((a, z) => a.start - z.start), [events]);

  const TIMELINE_H = ((dispEnd - dispStart) / 60) * PX_PER_HOUR;
  const PX_PER_MIN = PX_PER_HOUR / 60;
  const yFor = (m: number) => (m - dispStart) * PX_PER_MIN;
  const hFor = (m: number) => m * PX_PER_MIN;
  const blockMin = (k: Block['kind']) => (k === 'break' || k === 'wrap') ? SNAP : MOVABLE_MIN;
  const clampStart = (start: number, dur: number) => Math.max(dispStart, Math.min(start, settings.workEndMin - dur));
  const clampDur = (dur: number, start: number, min: number) => Math.max(min, Math.min(dur, dispEnd - start));
  // Nudge a [start,dur] off any calendar meeting to the nearest free time.
  const avoidCalendar = (start: number, dur: number): number => {
    let s = clampStart(start, dur);
    for (let g = 0; g < calBusy.length + 2; g++) {
      const clash = calBusy.find(e => s < e.end && s + dur > e.start);
      if (!clash) return s;
      s = clash.end + dur <= settings.workEndMin ? clash.end : Math.max(dispStart, clash.start - dur);
    }
    return s;
  };
  const labelFor = (b: Block) => b.kind === 'break' ? 'Lunch' : b.kind === 'wrap' ? 'Wrap up · plan tomorrow' : (b.label ?? 'Custom');

  // Seed the structural lunch + wrap blocks from settings, placed around meetings.
  const seedFixtures = (): Block[] => {
    const out: Block[] = [];
    const busy = [...calBusy];
    if (settings.lunchStartMin != null && settings.lunchMinutes > 0) {
      const s = findSlot(settings.lunchStartMin, settings.lunchMinutes, busy, settings.workStartMin, settings.workEndMin) ?? settings.lunchStartMin;
      out.push({ key: 'lunch', kind: 'break', start: s, dur: settings.lunchMinutes });
      busy.push({ start: s, end: s + settings.lunchMinutes });
    }
    if (settings.wrapMinutes > 0) {
      const target = settings.workEndMin - settings.wrapMinutes;
      const overlaps = calBusy.some(e => target < e.end && target + settings.wrapMinutes > e.start);
      const s = overlaps ? (findSlot(target, settings.wrapMinutes, busy, settings.workStartMin, settings.workEndMin) ?? target) : target;
      out.push({ key: 'wrap', kind: 'wrap', start: s, dur: settings.wrapMinutes });
    }
    return out;
  };

  // Generate a fresh layout: schedule the queue around meetings + kept blocks.
  const generate = (keep: Block[], fromMin: number): Block[] => {
    const busy: Busy[] = [...calBusy, ...keep.map(c => ({ start: c.start, end: c.start + c.dur }))].sort((a, z) => a.start - z.start);
    const startFrom = Math.max(Math.ceil(fromMin / SNAP) * SNAP, settings.workStartMin);
    const out: Block[] = [...keep];
    let cursor = startFrom;
    for (const it of queue) {
      const slot = findSlot(Math.max(cursor, startFrom), it.minutes, busy, settings.workStartMin, settings.workEndMin);
      if (slot == null) continue;
      out.push({ key: it.id, kind: it.kind, start: slot, dur: it.minutes });
      busy.push({ start: slot, end: slot + it.minutes }); busy.sort((a, z) => a.start - z.start);
      cursor = slot + it.minutes + settings.bufferMinutes;
    }
    return out;
  };

  function save(next: Block[], calState: CalSync | null = calRef.current) {
    setBlocks(next);
    fetch('/api/users/organise-plan', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ date: planDate, plan: { v: 1, blocks: next, calendar: calState ?? undefined } }) }).catch(() => {});
    // Tell the header a plan now exists for today (drives the "plan ready" dot).
    window.dispatchEvent(new CustomEvent('smith:organise-plan-saved'));
  }

  useEffect(() => {
    if (didGenerate.current || !calLoaded || !planLoaded || blocks !== null) return;
    didGenerate.current = true;
    save(generate(seedFixtures(), openMin));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [calLoaded, planLoaded, blocks]);

  const NONQUEUE = ['custom', 'break', 'wrap'];
  const ready = blocks !== null;
  const rendered = (blocks ?? []).map(b => ({ block: b, item: NONQUEUE.includes(b.kind) ? null : queueById.get(b.key) ?? undefined }))
    .filter(r => NONQUEUE.includes(r.block.kind) || r.item !== undefined) as { block: Block; item: PlanItem | null }[];
  const scheduledKeys = new Set((blocks ?? []).map(b => b.key));
  const notScheduled = queue.filter(q => !scheduledKeys.has(q.id));

  // Keep the edited block fixed and shrink neighbours so blocks never overlap.
  function resolveOverlaps(list: Block[], anchorKey: string): Block[] {
    const arr = [...list].sort((a, b) => a.start - b.start);
    const ai = arr.findIndex(b => b.key === anchorKey);
    if (ai < 0) return list;
    let floor = arr[ai].start + arr[ai].dur;
    for (let i = ai + 1; i < arr.length; i++) {
      const b = arr[i], end = b.start + b.dur, min = blockMin(b.kind);
      if (b.start < floor) { const nd = Math.max(min, end - floor); arr[i] = { ...b, start: floor, dur: nd }; floor += nd; }
      else floor = end;
    }
    let ceil = arr[ai].start;
    for (let i = ai - 1; i >= 0; i--) {
      const b = arr[i], end = b.start + b.dur, min = blockMin(b.kind);
      if (end > ceil) { const nd = Math.max(min, ceil - b.start); arr[i] = { ...b, start: ceil - nd, dur: nd }; ceil -= nd; }
      else ceil = b.start;
    }
    return arr.map(b => { const min = blockMin(b.kind); const start = Math.max(dispStart, Math.min(b.start, dispEnd - min)); return { ...b, start, dur: Math.max(min, Math.min(b.dur, dispEnd - start)) }; });
  }

  const plannedMins = rendered.reduce((n, r) => n + (r.block.kind === 'break' || r.block.kind === 'wrap' ? 0 : r.block.dur), 0);
  const nowVisible = nowMin >= dispStart && nowMin <= dispEnd;

  // Live "on now / up next".
  const bannerItems = [
    ...rendered.map(r => ({ start: r.block.start, end: r.block.start + r.block.dur, title: r.item?.label ?? labelFor(r.block), open: r.item?.onOpen ?? null })),
    ...events.map(e => ({ start: e.start, end: e.end, title: e.title, open: null as (() => void) | null })),
  ].sort((a, b) => a.start - b.start);
  const currentItem = bannerItems.find(i => i.start <= nowMin && nowMin < i.end) ?? null;
  const nextItem = bannerItems.find(i => i.start > nowMin) ?? null;

  // ── Pointer drag (move / resize) on a block; tap (no move) = onTap ──────────
  function beginDrag(e: React.PointerEvent, key: string, mode: 'move' | 'resize', baseStart: number, baseDur: number, onTap?: () => void) {
    e.preventDefault(); e.stopPropagation();
    const swallow = (ce: Event) => { ce.stopPropagation(); ce.stopImmediatePropagation(); };
    window.addEventListener('click', swallow, { capture: true, once: true });
    const startY = e.clientY; let deltaMin = 0, moved = false;
    setDrag({ key, mode, deltaMin: 0 });
    const onMove = (ev: PointerEvent) => { const dPx = ev.clientY - startY; deltaMin = Math.round(dPx / PX_PER_MIN / SNAP) * SNAP; if (Math.abs(dPx) > 4) moved = true; setDrag({ key, mode, deltaMin }); };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); setDrag(null);
      if (!moved) { onTap?.(); return; }
      const min = blockMin((blocks ?? []).find(b => b.key === key)?.kind ?? 'task');
      const edited = (blocks ?? []).map(b => {
        if (b.key !== key) return b;
        if (mode === 'move') return { ...b, start: avoidCalendar(baseStart + deltaMin, baseDur) };
        // Resize: keep the block off the next meeting.
        let nd = clampDur(baseDur + deltaMin, baseStart, min);
        const next = calBusy.find(ev2 => ev2.start >= baseStart);
        if (next) nd = Math.max(min, Math.min(nd, next.start - baseStart));
        return { ...b, dur: nd };
      });
      save(resolveOverlaps(edited, key));
    };
    window.addEventListener('pointermove', onMove); window.addEventListener('pointerup', onUp);
  }

  const yToMin = (y: number) => Math.round((dispStart + (y / PX_PER_MIN)) / SNAP) * SNAP;
  function addBlockAt(offsetY: number) {
    customSeq.current += 1;
    const key = `focus-${Date.now()}-${customSeq.current}`;
    save(resolveOverlaps([...(blocks ?? []), { key, kind: 'custom', label: 'Custom', start: avoidCalendar(yToMin(offsetY), MOVABLE_MIN), dur: MOVABLE_MIN }], key));
  }
  // Drag a "not in the plan" item onto the timeline to schedule it there.
  function addQueueItemAt(id: string, y: number) {
    const it = queueById.get(id);
    if (!it || (blocks ?? []).some(b => b.key === id)) return;
    const dur = Math.max(MOVABLE_MIN, it.minutes);
    save(resolveOverlaps([...(blocks ?? []), { key: it.id, kind: it.kind, start: avoidCalendar(yToMin(y), dur), dur }], it.id));
  }
  function removeBlock(key: string) { save((blocks ?? []).filter(b => b.key !== key)); }
  function rePlan() {
    const keep = (blocks ?? []).filter(b => b.kind === 'custom' || b.kind === 'break' || b.kind === 'wrap');
    const hasBreak = keep.some(b => b.kind === 'break'), hasWrap = keep.some(b => b.kind === 'wrap');
    const seeds = seedFixtures().filter(s => (s.kind === 'break' && !hasBreak) || (s.kind === 'wrap' && !hasWrap));
    save(generate([...keep, ...seeds], nowMin));
  }
  // Ticking a task done marks it complete AND records a "from your plan" timesheet
  // suggestion with the block's allotted time, linked to the task (to confirm in
  // Timesheets). Only tasks (which carry a client + task id) do this.
  function recordSuggestion(task: Task, minutes: number) {
    fetch('/api/timesheets/plan-suggestions', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ taskId: task.id, clientId: task.client_id ?? null, title: task.title, isInternal: !!task.is_internal, minutes, date: planDate }),
    }).then(() => window.dispatchEvent(new CustomEvent('smith:timesheet-plan-suggestion'))).catch(() => {});
  }
  function markTaskDone(task: Task | undefined, minutes: number) {
    if (!task) return;
    onMarkDone(task.id);
    recordSuggestion(task, minutes);
  }
  // A linked custom block logs its time against the task (without completing it).
  function logCustom(block: Block) {
    const t = tasks.find(x => x.id === block.taskId);
    if (t) recordSuggestion(t, block.dur);
  }
  function editBlock(patch: { label: string; color: string; taskId: string | null; taskTitle: string | null; clientName: string | null }) {
    if (!editingKey) return;
    save((blocks ?? []).map(b => b.key === editingKey ? { ...b, ...patch } : b));
    setEditingKey(null);
  }

  // ── Add the finished plan to the user's Google Calendar (idempotent sync) ────
  const isoFor = (min: number) => `${planDate}T${minToHHMM(min)}:00`;
  const summaryFor = (block: Block, item: PlanItem | null): string => {
    if (block.kind === 'custom') return block.taskTitle ? `${block.label ?? 'Focus'} · ${block.taskTitle}` : (block.label ?? 'Focus time');
    if (block.kind === 'break') return 'Lunch';
    if (block.kind === 'wrap') return 'Wrap up · plan tomorrow';
    if (!item) return labelFor(block);
    return item.kind === 'task' && item.sub ? `${item.label} · ${item.sub}` : item.label;
  };
  function buildCalPayload() {
    const items = rendered.map(({ block, item }) => ({
      key: block.key, summary: summaryFor(block, item),
      startISO: isoFor(block.start), endISO: isoFor(block.start + block.dur),
    }));
    const sig = items.map(i => `${i.key}:${i.startISO}:${i.endISO}:${i.summary}`).sort().join('|');
    return { items, sig };
  }
  async function syncToCalendar() {
    setSyncing(true); setSyncErr(null);
    const { items, sig } = buildCalPayload();
    try {
      const res = await fetch('/api/organise-plan/calendar', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date: planDate, visibility, blocks: items, existing: cal?.eventIds ?? {} }),
      });
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || 'sync-failed'); }
      const data = await res.json();
      const next: CalSync = { eventIds: data.eventIds ?? {}, visibility, sig };
      setCal(next); calRef.current = next;
      save(blocks ?? [], next);
    } catch (err) {
      setSyncErr(err instanceof Error && err.message === 'calendar-not-connected' ? 'Connect Google Calendar first.' : 'Could not sync to calendar.');
    } finally { setSyncing(false); }
  }
  async function removeFromCalendar() {
    if (!cal) return;
    setSyncing(true); setSyncErr(null);
    try {
      await fetch('/api/organise-plan/calendar', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date: planDate, visibility, blocks: [], existing: cal.eventIds }),
      });
      setCal(null); calRef.current = null;
      save(blocks ?? [], null);
    } catch { setSyncErr('Could not update calendar.'); }
    finally { setSyncing(false); }
  }

  const previewFor = (key: string, start: number, dur: number) => {
    if (!drag || drag.key !== key) return { start, dur };
    const min = blockMin((blocks ?? []).find(b => b.key === key)?.kind ?? 'task');
    return drag.mode === 'move' ? { start: clampStart(start + drag.deltaMin, dur), dur } : { start, dur: clampDur(dur + drag.deltaMin, start, min) };
  };

  const calDirty = cal !== null && (cal.sig !== buildCalPayload().sig || cal.visibility !== visibility);

  if (!ready) {
    return (
      <div className="flex items-center justify-center gap-2 py-16 text-indigo-600">
        <Loader2 className="h-4 w-4 animate-spin" /><span className="text-sm font-semibold">Planning your day…</span>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Next-task banner */}
      {(currentItem || nextItem) && (
        <div className={`flex items-center gap-2.5 rounded-xl px-3.5 py-2.5 ${currentItem ? 'text-white' : 'bg-indigo-50 text-indigo-800'}`} style={currentItem ? { background: 'linear-gradient(135deg,#4f46e5,#7c3aed)' } : undefined}>
          {currentItem ? <PlayCircle size={17} className="shrink-0" /> : <Clock3 size={16} className="shrink-0 text-indigo-500" />}
          <p className="min-w-0 flex-1 text-[12.5px] leading-snug">
            {currentItem ? (<>On now until {minToHHMM(currentItem.end)} — <span className="font-bold">{currentItem.title}</span>{nextItem && <span className="opacity-80"> · next {minToHHMM(nextItem.start)}: {nextItem.title}</span>}</>)
              : (<>Up next at {minToHHMM(nextItem!.start)} — <span className="font-bold">{nextItem!.title}</span></>)}
          </p>
          {currentItem?.open && <button onClick={currentItem.open} className="shrink-0 rounded-lg bg-white/20 px-2.5 py-1 text-[11px] font-semibold hover:bg-white/30">Open</button>}
        </div>
      )}

      {/* New-work nudge */}
      {notScheduled.length > 0 && (
        <div className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-[12px] text-amber-800">
          <Plus size={14} className="shrink-0 text-amber-600" />
          <span className="min-w-0 flex-1"><span className="font-semibold">{notScheduled.length} item{notScheduled.length === 1 ? '' : 's'}</span> not in today&rsquo;s plan yet — Re-plan to slot {notScheduled.length === 1 ? 'it' : 'them'} in.</span>
          <button onClick={rePlan} className="shrink-0 inline-flex items-center gap-1 rounded-lg bg-amber-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-amber-700"><RotateCcw size={11} /> Re-plan</button>
        </div>
      )}

      {/* Summary + controls */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[12px]">
        <span className="font-semibold text-gray-700">{fmtDur(plannedMins)} planned</span>
        {events.length > 0 && <span className="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-2 py-0.5 font-semibold text-indigo-600"><CalendarClock size={12} /> around {events.length} meeting{events.length === 1 ? '' : 's'}</span>}
        <span className="ml-auto hidden text-gray-400 sm:inline">drag to move · edge to resize · click empty time to add</span>
        <button onClick={rePlan} className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-2 py-1 font-semibold text-gray-600 hover:bg-gray-50"><RotateCcw size={12} /> Re-plan</button>
      </div>

      {/* Add to calendar */}
      {rendered.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-gray-100 bg-gray-50/60 px-3 py-2">
          {!calConnected ? (
            <p className="inline-flex items-center gap-1.5 text-[12px] text-gray-500"><CalendarPlus size={13} className="text-gray-400" /> Connect your Google Calendar to add this plan to it.</p>
          ) : (
            <>
              <span className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-gray-700">
                {cal ? <CalendarCheck size={14} className="text-emerald-600" /> : <CalendarPlus size={14} className="text-indigo-500" />}
                {cal ? (calDirty ? 'Plan changed since last sync' : 'On your calendar') : 'Add this plan to your calendar'}
              </span>
              <div className="inline-flex items-center rounded-lg border border-gray-200 bg-white p-0.5 text-[11px] font-semibold">
                <Tooltip label="Only you see the details — colleagues see “Busy”">
                  <button onClick={() => setVisibility('private')} className={`inline-flex items-center gap-1 rounded-md px-2 py-1 ${visibility === 'private' ? 'bg-indigo-50 text-indigo-700' : 'text-gray-500 hover:bg-gray-50'}`}><Lock size={11} /> Private</button>
                </Tooltip>
                <Tooltip label="Colleagues can see these blocks on the team calendar">
                  <button onClick={() => setVisibility('shared')} className={`inline-flex items-center gap-1 rounded-md px-2 py-1 ${visibility === 'shared' ? 'bg-indigo-50 text-indigo-700' : 'text-gray-500 hover:bg-gray-50'}`}><Users size={11} /> Shared</button>
                </Tooltip>
              </div>
              <div className="ml-auto flex items-center gap-2">
                {syncErr && <span className="text-[11px] font-semibold text-rose-500">{syncErr}</span>}
                {cal && <button onClick={removeFromCalendar} disabled={syncing} className="text-[11px] font-semibold text-gray-400 hover:text-rose-500 disabled:opacity-50">Remove</button>}
                <button onClick={syncToCalendar} disabled={syncing || (!!cal && !calDirty)}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-indigo-700 disabled:opacity-50">
                  {syncing ? <Loader2 size={13} className="animate-spin" /> : cal ? (calDirty ? <RotateCcw size={13} /> : <CalendarCheck size={13} />) : <CalendarPlus size={13} />}
                  {cal ? (calDirty ? 'Update calendar' : 'Synced') : 'Add to calendar'}
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {rendered.length === 0 ? (
        <p className="rounded-xl bg-gray-50 px-4 py-3 text-[12.5px] text-gray-500">Nothing scheduled into the day. {notScheduled.length > 0 ? 'Press Re-plan to build it.' : "You're all clear."}</p>
      ) : (
        <div className="flex" style={{ height: TIMELINE_H }}>
          {/* Hour gutter */}
          <div className="relative w-11 shrink-0">
            {Array.from({ length: (dispEnd - dispStart) / 60 + 1 }, (_, i) => (
              <div key={i} className="absolute right-2 -translate-y-1/2 text-[10px] tabular-nums text-gray-400" style={{ top: i * PX_PER_HOUR }}>{String(dispStart / 60 + i).padStart(2, '0')}:00</div>
            ))}
          </div>
          {/* Timeline column */}
          <div className="relative flex-1 rounded-xl border border-gray-100 bg-gray-50/40"
            onClick={e => { if (e.target === e.currentTarget) addBlockAt(e.nativeEvent.offsetY); }}
            onDragOver={e => { if (e.dataTransfer.types.includes('text/omd-item')) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } }}
            onDrop={e => { const id = e.dataTransfer.getData('text/omd-item'); if (id) { e.preventDefault(); addQueueItemAt(id, e.clientY - e.currentTarget.getBoundingClientRect().top); } }}>
            {Array.from({ length: (dispEnd - dispStart) / 60 }, (_, i) => <div key={i} className="pointer-events-none absolute left-0 right-0 border-t border-dashed border-black/[0.05]" style={{ top: i * PX_PER_HOUR }} />)}

            {events.map(ev => (
              <div key={ev.id} className="pointer-events-none absolute left-1.5 right-1.5 overflow-hidden rounded-lg border border-dashed border-indigo-300 bg-indigo-50/80 px-2 py-1" style={{ top: Math.max(0, yFor(ev.start)), height: Math.max(18, hFor(ev.minutes)) }}>
                <p className="truncate text-[11px] font-semibold text-indigo-900">{ev.title}</p>
                {hFor(ev.minutes) > 30 && <p className="truncate text-[10px] text-indigo-500">{ev.startHHmm} · {fmtDur(ev.minutes)}</p>}
              </div>
            ))}

            {rendered.map(({ block, item }) => {
              const p = previewFor(block.key, block.start, block.dur);
              const kind = block.kind;
              const soft = kind === 'break' || kind === 'wrap';   // soft strip; custom uses its colour accent
              const h = Math.max(soft ? 26 : 22, hFor(p.dur));
              const color = kind === 'break' ? '#d97706' : kind === 'wrap' ? '#64748b' : kind === 'custom' ? (block.color ?? '#64748b') : (item?.color ?? '#6366f1');
              const softBg = kind === 'break' ? 'border border-amber-200 bg-amber-50/80' : 'border border-slate-300 bg-slate-100';
              const labelCls = kind === 'break' ? 'text-amber-800' : kind === 'wrap' ? 'text-slate-600' : 'text-gray-800';
              const label = item?.label ?? labelFor(block);
              const sub = kind === 'custom' && block.taskTitle ? `${block.taskTitle}${block.clientName ? ` · ${block.clientName}` : ''}` : (item && item.kind !== 'admin' ? item.sub : undefined);
              const dragging = drag?.key === block.key;
              return (
                <div key={block.key} onPointerDown={e => beginDrag(e, block.key, 'move', block.start, block.dur, item?.onOpen)}
                  className={`group absolute left-1.5 right-1.5 overflow-hidden rounded-lg px-2.5 py-1.5 shadow-sm ${dragging ? 'z-20 cursor-grabbing ring-2' : 'cursor-grab'} ${soft ? softBg : ''}`}
                  style={{ top: Math.max(0, yFor(p.start)), height: h, ...(soft ? {} : { background: `${color}1f`, borderLeft: `3px solid ${color}` }), touchAction: 'none', ...(dragging ? { boxShadow: `0 0 0 2px ${color}55` } : {}) }}>
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <p className={`flex items-center gap-1 truncate text-[12px] font-semibold ${labelCls}`}>
                        {item?.kind === 'admin' && <CheckCircle2 size={12} style={{ color }} className="shrink-0" />}
                        {item?.kind === 'chase' && <AlertTriangle size={12} style={{ color }} className="shrink-0" />}
                        {kind === 'custom' && block.taskId && <Link2 size={11} style={{ color }} className="shrink-0" />}
                        <span className="truncate">{label}{item?.kind === 'admin' && item.sub ? ` (${item.sub})` : ''}</span>
                      </p>
                      {h > 34 && <p className="truncate text-[10.5px] text-gray-500">{minToHHMM(p.start)}–{minToHHMM(p.start + p.dur)}{sub ? ` · ${sub}` : ''}</p>}
                    </div>
                    {item?.onDone && <button onPointerDown={e => e.stopPropagation()} onClick={() => markTaskDone(item.task, block.dur)} aria-label="Mark done" className="shrink-0 rounded-md p-0.5 text-gray-300 opacity-0 transition-opacity hover:bg-emerald-50 hover:text-emerald-600 group-hover:opacity-100"><CheckCircle2 size={16} /></button>}
                    {kind === 'custom' && block.taskId && <button onPointerDown={e => e.stopPropagation()} onClick={() => logCustom(block)} aria-label="Log time" className="shrink-0 rounded-md p-0.5 text-gray-300 opacity-0 transition-opacity hover:bg-emerald-50 hover:text-emerald-600 group-hover:opacity-100"><CheckCircle2 size={15} /></button>}
                    {kind === 'custom' && <button onPointerDown={e => e.stopPropagation()} onClick={() => setEditingKey(block.key)} aria-label="Edit block" className="shrink-0 rounded-md p-0.5 text-slate-300 opacity-0 hover:bg-indigo-50 hover:text-indigo-600 group-hover:opacity-100"><Pencil size={14} /></button>}
                    {kind === 'custom' && <button onPointerDown={e => e.stopPropagation()} onClick={() => removeBlock(block.key)} aria-label="Remove block" className="shrink-0 rounded-md p-0.5 text-slate-300 opacity-0 hover:bg-rose-50 hover:text-rose-500 group-hover:opacity-100"><X size={15} /></button>}
                  </div>
                  <div onPointerDown={e => beginDrag(e, block.key, 'resize', block.start, block.dur)} className="absolute inset-x-0 bottom-0 flex h-2.5 cursor-ns-resize items-end justify-center opacity-0 group-hover:opacity-100" style={{ touchAction: 'none' }}>
                    <span className="mb-0.5 h-1 w-6 rounded-full" style={{ background: color }} />
                  </div>
                </div>
              );
            })}

            {nowVisible && (
              <div className="pointer-events-none absolute left-0 right-0 z-10" style={{ top: yFor(nowMin) }}>
                <div className="relative h-px bg-red-500"><span className="absolute -left-0.5 -top-[3px] h-[7px] w-[7px] rounded-full bg-red-500" /><span className="absolute right-1 -top-[7px] rounded bg-red-500 px-1 text-[8.5px] font-bold text-white">now</span></div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Not-in-plan list */}
      {notScheduled.length > 0 && (
        <div>
          <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-amber-700"><MoveRight size={12} /> Not in the plan ({notScheduled.length}) <span className="font-medium normal-case tracking-normal text-gray-400">· drag onto the day, or Re-plan</span></p>
          <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
            {notScheduled.map(it => (
              <div key={it.id} draggable
                onDragStart={e => { e.dataTransfer.setData('text/omd-item', it.id); e.dataTransfer.effectAllowed = 'copy'; }}
                className="flex items-center gap-1.5 rounded-lg border border-gray-100 bg-white px-2 py-2 group cursor-grab active:cursor-grabbing">
                <GripVertical size={13} className="shrink-0 text-gray-300 group-hover:text-gray-400" />
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: it.color }} />
                <button onClick={it.onOpen} className="min-w-0 flex-1 text-left"><p className="truncate text-[12px] font-semibold text-gray-800">{it.label}</p>{it.sub && <p className="truncate text-[10.5px] text-gray-500">{it.sub}</p>}</button>
                {it.onDone && <button onClick={() => markTaskDone(it.task, it.minutes)} aria-label="Mark done" className="shrink-0 rounded-md p-1 text-gray-300 hover:bg-emerald-50 hover:text-emerald-600"><CheckCircle2 size={15} /></button>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Footnotes */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-gray-400">
        {waitingCount > 0 && <span className="inline-flex items-center gap-1"><PauseCircle size={12} /> {waitingCount} waiting on clients — not scheduled</span>}
        {chaseCount > 0 && <span className="inline-flex items-center gap-1"><AlertTriangle size={12} className="text-red-400" /> {chaseCount} overdue grouped into the chase block</span>}
        <span className="inline-flex items-center gap-1"><Plus size={11} /> Click an empty slot to block out focus time</span>
      </div>

      {editingKey && (() => {
        const b = (blocks ?? []).find(x => x.key === editingKey);
        if (!b) return null;
        return <OrganiseMyDayBlockEditor initial={{ label: b.label ?? 'Custom', color: b.color, taskId: b.taskId, taskTitle: b.taskTitle, clientName: b.clientName }} tasks={tasks} onSave={editBlock} onClose={() => setEditingKey(null)} />;
      })()}
    </div>
  );
}
