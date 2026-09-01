'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, CalendarClock, MoveRight, RotateCcw, Plus, X, PlayCircle, Clock3 } from 'lucide-react';
import { buildDayPlan, DAY_BUCKETS, type DayBucketKey } from '@/lib/tasks/dayPlan';
import { todayIso } from '@/lib/timesheets/format';
import type { Task } from '@/types';

// Stage B day-planner: the user's tasks auto-scheduled into today's working hours
// AROUND their Google Calendar events (fixed blocks), from "now" (never the past).
// Stage B.2 adds hand-editing: drag a task to reschedule, drag its edge to resize,
// click empty time to insert a focus block, and Reset to re-auto-plan. All edits
// are client-side/ephemeral (the plan is rebuilt each time it's opened).

const DAY_START = 8;    // 08:00
const DAY_END = 19;     // 19:00
const HOURS = DAY_END - DAY_START;
const PX_PER_HOUR = 60;
const TIMELINE_H = HOURS * PX_PER_HOUR;
const PX_PER_MIN = TIMELINE_H / (HOURS * 60);
const SNAP = 15;

interface CalEvent { id: string; title: string; startHHmm: string; minutes: number }
interface Busy { start: number; end: number }
interface CustomBlock { id: string; label: string; start: number; dur: number }
type DragState = { id: string; kind: 'task' | 'custom'; mode: 'move' | 'resize'; deltaMin: number } | null;

const BUCKET_COLOR: Record<DayBucketKey, string> = Object.fromEntries(DAY_BUCKETS.map(b => [b.key, b.color])) as Record<DayBucketKey, string>;
const BUCKET_LABEL: Record<DayBucketKey, string> = Object.fromEntries(DAY_BUCKETS.map(b => [b.key, b.label])) as Record<DayBucketKey, string>;

const parseMin = (hhmm: string): number => { const [h, m] = (hhmm || '').split(':').map(Number); return (h || 0) * 60 + (m || 0); };
const minToHHMM = (m: number): string => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(Math.round(m) % 60).padStart(2, '0')}`;
const yFor = (min: number): number => ((min - DAY_START * 60) / (HOURS * 60)) * TIMELINE_H;
const hFor = (min: number): number => (min / (HOURS * 60)) * TIMELINE_H;
function fmtDur(min: number): string { const h = Math.floor(min / 60), m = min % 60; return h ? (m ? `${h}h ${m}m` : `${h}h`) : `${m}m`; }
const clampStart = (start: number, dur: number): number => Math.max(DAY_START * 60, Math.min(start, DAY_END * 60 - dur));
const clampDur = (dur: number, start: number): number => Math.max(SNAP, Math.min(dur, DAY_END * 60 - start));

function estimateMinutes(t: Task): number {
  const remaining = (t.steps ?? []).filter(s => !s.is_client_step && s.status !== 'complete' && s.status !== 'skipped').length;
  return Math.min(Math.max(remaining * 25, 30), 180);
}

function nextFreeStart(from: number, dur: number, busy: Busy[]): number | null {
  let start = Math.max(from, DAY_START * 60);
  for (let guard = 0; guard < 300; guard++) {
    if (start + dur > DAY_END * 60) return null;
    const clash = busy.find(b => start < b.end && start + dur > b.start);
    if (!clash) return start;
    start = Math.ceil(clash.end / SNAP) * SNAP;
  }
  return null;
}

interface Props {
  tasks: Task[];
  userId: string;
  onOpenTask: (t: Task) => void;
  onMarkDone: (id: string) => void;
}

export default function OrganiseMyDayTimeline({ tasks, userId, onOpenTask, onMarkDone }: Props) {
  const [calEvents, setCalEvents] = useState<CalEvent[]>([]);
  const [startOverride, setStartOverride] = useState<Record<string, number>>({});
  const [durOverride, setDurOverride] = useState<Record<string, number>>({});
  const [customs, setCustoms] = useState<CustomBlock[]>([]);
  const [drag, setDrag] = useState<DragState>(null);
  const customSeq = useRef(0);
  // `openMin` fixes the schedule at open-time so blocks don't reshuffle under you;
  // `nowMin` ticks live (every 30s) so the now-marker + next-task banner track the
  // real time as you work.
  const openMin = useMemo(() => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); }, []);
  const [nowMin, setNowMin] = useState(openMin);
  useEffect(() => {
    const id = setInterval(() => { const d = new Date(); setNowMin(d.getHours() * 60 + d.getMinutes()); }, 30_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    let live = true;
    fetch('/api/calendar/status').then(r => (r.ok ? r.json() : { connected: false })).then(d => {
      if (!d?.connected || !live) return;
      fetch(`/api/timesheets/calendar?date=${todayIso()}`)
        .then(r => (r.ok ? r.json() : { events: [] }))
        .then(cd => { if (live) setCalEvents((cd.events ?? []) as CalEvent[]); })
        .catch(() => {});
    }).catch(() => {});
    return () => { live = false; };
  }, []);

  const durOf = (t: Task) => durOverride[t.id] ?? estimateMinutes(t);
  const hasEdits = Object.keys(startOverride).length > 0 || Object.keys(durOverride).length > 0 || customs.length > 0;

  const { events, blocks, unscheduled, startFrom } = useMemo(() => {
    const plan = buildDayPlan(tasks, userId);
    const queue: { task: Task; bucket: DayBucketKey }[] = [];
    for (const b of DAY_BUCKETS) for (const t of plan[b.key]) queue.push({ task: t, bucket: b.key });

    const events = calEvents
      .map(e => ({ ...e, start: parseMin(e.startHHmm), end: parseMin(e.startHHmm) + e.minutes }))
      .filter(e => e.end > DAY_START * 60 && e.start < DAY_END * 60);

    const startFrom = Math.max(Math.ceil(openMin / SNAP) * SNAP, DAY_START * 60);

    // Fixed busy = calendar events + custom blocks + manually-placed tasks.
    const busy: Busy[] = [
      ...events.map(e => ({ start: e.start, end: e.end })),
      ...customs.map(c => ({ start: c.start, end: c.start + c.dur })),
    ];
    const fixed: { task: Task; bucket: DayBucketKey; start: number; dur: number; pinned: boolean }[] = [];
    for (const item of queue) {
      const ov = startOverride[item.task.id];
      if (ov == null) continue;
      const dur = durOf(item.task);
      fixed.push({ ...item, start: ov, dur, pinned: true });
      busy.push({ start: ov, end: ov + dur });
    }
    busy.sort((a, b) => a.start - b.start);

    // Auto-schedule the rest around everything fixed.
    const auto: typeof fixed = [];
    const unscheduled: { task: Task; bucket: DayBucketKey }[] = [];
    let cursor = startFrom;
    for (const item of queue) {
      if (startOverride[item.task.id] != null) continue;
      const dur = durOf(item.task);
      const slot = nextFreeStart(Math.max(cursor, startFrom), dur, busy);
      if (slot == null) { unscheduled.push(item); continue; }
      auto.push({ ...item, start: slot, dur, pinned: false });
      busy.push({ start: slot, end: slot + dur });
      busy.sort((a, b) => a.start - b.start);
      cursor = slot + dur;
    }
    return { events, blocks: [...fixed, ...auto], unscheduled, startFrom };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks, userId, calEvents, openMin, startOverride, durOverride, customs]);

  const plannedMins = blocks.reduce((n, b) => n + b.dur, 0);
  const nowVisible = nowMin >= DAY_START * 60 && nowMin <= DAY_END * 60;

  // Live "what should I be doing now / up next" for the top banner.
  const timelineItems = [
    ...blocks.map(b => ({ start: b.start, end: b.start + b.dur, title: b.task.title, task: b.task as Task | null })),
    ...customs.map(c => ({ start: c.start, end: c.start + c.dur, title: c.label, task: null as Task | null })),
  ].sort((a, z) => a.start - z.start);
  const currentItem = timelineItems.find(i => i.start <= nowMin && nowMin < i.end) ?? null;
  const nextItem = timelineItems.find(i => i.start > nowMin) ?? null;

  // Pointer drag — move a block (change start) or resize it (change duration).
  // Snaps to 15 min; a press without movement is treated as a tap (onTap).
  function beginDrag(
    e: React.PointerEvent, id: string, kind: 'task' | 'custom', mode: 'move' | 'resize',
    baseStart: number, baseDur: number, onTap?: () => void,
  ) {
    e.preventDefault();
    e.stopPropagation();
    const swallow = (ce: Event) => { ce.stopPropagation(); ce.stopImmediatePropagation(); };
    window.addEventListener('click', swallow, { capture: true, once: true });
    const startY = e.clientY;
    let deltaMin = 0;
    let moved = false;
    setDrag({ id, kind, mode, deltaMin: 0 });
    const onMove = (ev: PointerEvent) => {
      const dPx = ev.clientY - startY;
      deltaMin = Math.round(dPx / PX_PER_MIN / SNAP) * SNAP;
      if (Math.abs(dPx) > 4) moved = true;
      setDrag({ id, kind, mode, deltaMin });
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      setDrag(null);
      if (!moved) { onTap?.(); return; }
      if (mode === 'move') {
        const ns = clampStart(baseStart + deltaMin, baseDur);
        if (kind === 'task') setStartOverride(o => ({ ...o, [id]: ns }));
        else setCustoms(cs => cs.map(c => (c.id === id ? { ...c, start: ns } : c)));
      } else {
        const nd = clampDur(baseDur + deltaMin, baseStart);
        if (kind === 'task') setDurOverride(o => ({ ...o, [id]: nd }));
        else setCustoms(cs => cs.map(c => (c.id === id ? { ...c, dur: nd } : c)));
      }
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }

  function addBlockAt(offsetY: number) {
    const min = Math.round((DAY_START * 60 + (offsetY / TIMELINE_H) * HOURS * 60) / SNAP) * SNAP;
    const start = clampStart(min, 30);
    customSeq.current += 1;
    setCustoms(cs => [...cs, { id: `focus-${customSeq.current}`, label: 'Focus time', start, dur: 30 }]);
  }

  function resetPlan() { setStartOverride({}); setDurOverride({}); setCustoms([]); }

  const previewFor = (id: string, kind: 'task' | 'custom', start: number, dur: number) => {
    if (!drag || drag.id !== id || drag.kind !== kind) return { start, dur };
    if (drag.mode === 'move') return { start: clampStart(start + drag.deltaMin, dur), dur };
    return { start, dur: clampDur(dur + drag.deltaMin, start) };
  };

  return (
    <div className="space-y-4">
      {/* Next-task banner — tracks the live clock */}
      {(currentItem || nextItem) && (
        <div
          className={`flex items-center gap-2.5 rounded-xl px-3.5 py-2.5 ${currentItem ? 'text-white' : 'bg-indigo-50 text-indigo-800'}`}
          style={currentItem ? { background: 'linear-gradient(135deg,#4f46e5,#7c3aed)' } : undefined}
        >
          {currentItem ? <PlayCircle size={17} className="shrink-0" /> : <Clock3 size={16} className="shrink-0 text-indigo-500" />}
          <p className="min-w-0 flex-1 text-[12.5px] leading-snug">
            {currentItem ? (
              <>On now until {minToHHMM(currentItem.end)} — <span className="font-bold">{currentItem.title}</span>
                {nextItem && <span className="opacity-80"> · next {minToHHMM(nextItem.start)}: {nextItem.title}</span>}</>
            ) : (
              <>Up next at {minToHHMM(nextItem!.start)} — <span className="font-bold">{nextItem!.title}</span></>
            )}
          </p>
          {currentItem?.task && (
            <button onClick={() => onOpenTask(currentItem.task!)} className="shrink-0 rounded-lg bg-white/20 px-2.5 py-1 text-[11px] font-semibold hover:bg-white/30">Open</button>
          )}
        </div>
      )}

      {/* Summary + controls */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[12px]">
        <span className="font-semibold text-gray-700">{fmtDur(plannedMins)} planned</span>
        {events.length > 0 && (
          <span className="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-2 py-0.5 font-semibold text-indigo-600">
            <CalendarClock size={12} /> around {events.length} meeting{events.length === 1 ? '' : 's'}
          </span>
        )}
        {unscheduled.length > 0 && (
          <span className="rounded-full bg-amber-50 px-2 py-0.5 font-semibold text-amber-700">{unscheduled.length} didn&rsquo;t fit</span>
        )}
        <span className="ml-auto hidden text-gray-400 sm:inline">drag to move · edge to resize · click empty time to add</span>
        {hasEdits && (
          <button onClick={resetPlan} className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-2 py-1 font-semibold text-gray-600 hover:bg-gray-50">
            <RotateCcw size={12} /> Re-plan
          </button>
        )}
      </div>

      {blocks.length === 0 && customs.length === 0 ? (
        <p className="rounded-xl bg-gray-50 px-4 py-3 text-[12.5px] text-gray-500">
          {startFrom + SNAP >= DAY_END * 60
            ? 'Your working day’s nearly done — nothing left to slot in. Outstanding work is listed below.'
            : 'Nothing to schedule into the day right now.'}
        </p>
      ) : (
      <div className="flex" style={{ height: TIMELINE_H }}>
        {/* Hour gutter */}
        <div className="relative w-11 shrink-0">
          {Array.from({ length: HOURS + 1 }, (_, i) => (
            <div key={i} className="absolute right-2 -translate-y-1/2 text-[10px] tabular-nums text-gray-400" style={{ top: (i / HOURS) * TIMELINE_H }}>
              {String(DAY_START + i).padStart(2, '0')}:00
            </div>
          ))}
        </div>

        {/* Timeline column */}
        <div
          className="relative flex-1 rounded-xl border border-gray-100 bg-gray-50/40"
          onClick={e => { if (e.target === e.currentTarget) addBlockAt(e.nativeEvent.offsetY); }}
        >
          {Array.from({ length: HOURS }, (_, i) => (
            <div key={i} className="pointer-events-none absolute left-0 right-0 border-t border-dashed border-black/[0.05]" style={{ top: (i / HOURS) * TIMELINE_H }} />
          ))}

          {/* Calendar events — fixed meeting blocks */}
          {events.map(ev => (
            <div key={ev.id} className="pointer-events-none absolute left-1.5 right-1.5 overflow-hidden rounded-lg border border-dashed border-indigo-300 bg-indigo-50/80 px-2 py-1"
              style={{ top: Math.max(0, yFor(ev.start)), height: Math.max(18, hFor(ev.minutes)) }}>
              <p className="truncate text-[11px] font-semibold text-indigo-900">{ev.title}</p>
              {hFor(ev.minutes) > 30 && <p className="truncate text-[10px] text-indigo-500">{ev.startHHmm} · {fmtDur(ev.minutes)}</p>}
            </div>
          ))}

          {/* Custom focus blocks */}
          {customs.map(c => {
            const p = previewFor(c.id, 'custom', c.start, c.dur);
            const h = Math.max(22, hFor(p.dur));
            const dragging = drag?.id === c.id && drag.kind === 'custom';
            return (
              <div key={c.id}
                onPointerDown={e => beginDrag(e, c.id, 'custom', 'move', c.start, c.dur)}
                className={`group absolute left-1.5 right-1.5 overflow-hidden rounded-lg border border-slate-300 bg-slate-100 px-2.5 py-1.5 ${dragging ? 'z-20 cursor-grabbing ring-2 ring-slate-300' : 'cursor-grab'}`}
                style={{ top: Math.max(0, yFor(p.start)), height: h, touchAction: 'none' }}>
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[12px] font-semibold text-slate-700">{c.label}</p>
                    {h > 34 && <p className="truncate text-[10.5px] text-slate-400">{minToHHMM(p.start)}–{minToHHMM(p.start + p.dur)}</p>}
                  </div>
                  <button onPointerDown={e => e.stopPropagation()} onClick={() => setCustoms(cs => cs.filter(x => x.id !== c.id))} aria-label="Remove block"
                    className="shrink-0 rounded-md p-0.5 text-slate-300 opacity-0 hover:bg-rose-50 hover:text-rose-500 group-hover:opacity-100">
                    <X size={15} />
                  </button>
                </div>
                <div onPointerDown={e => beginDrag(e, c.id, 'custom', 'resize', c.start, c.dur)}
                  className="absolute inset-x-0 bottom-0 flex h-2.5 cursor-ns-resize items-end justify-center opacity-0 group-hover:opacity-100" style={{ touchAction: 'none' }}>
                  <span className="mb-0.5 h-1 w-6 rounded-full bg-slate-400" />
                </div>
              </div>
            );
          })}

          {/* Task blocks */}
          {blocks.map(({ task, bucket, start, dur, pinned }) => {
            const p = previewFor(task.id, 'task', start, dur);
            const h = Math.max(22, hFor(p.dur));
            const color = BUCKET_COLOR[bucket];
            const dragging = drag?.id === task.id && drag.kind === 'task';
            return (
              <div key={task.id}
                onPointerDown={e => beginDrag(e, task.id, 'task', 'move', start, dur, () => onOpenTask(task))}
                className={`group absolute left-1.5 right-1.5 overflow-hidden rounded-lg px-2.5 py-1.5 shadow-sm ${dragging ? 'z-20 cursor-grabbing ring-2' : 'cursor-grab'}`}
                style={{ top: Math.max(0, yFor(p.start)), height: h, background: `${color}1f`, borderLeft: `3px solid ${color}`, touchAction: 'none', ...(dragging ? { boxShadow: `0 0 0 2px ${color}55` } : {}) }}>
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[12px] font-semibold text-gray-800">{task.title}</p>
                    {h > 34 && (
                      <p className="truncate text-[10.5px] text-gray-500">
                        {minToHHMM(p.start)}–{minToHHMM(p.start + p.dur)} · {task.is_internal ? 'Internal' : (task.client?.name ?? '—')}
                      </p>
                    )}
                    {h > 52 && (
                      <p className="mt-0.5 text-[9.5px] font-semibold uppercase tracking-wide" style={{ color }}>
                        {BUCKET_LABEL[bucket]}{pinned ? ' · moved' : ''}
                      </p>
                    )}
                  </div>
                  <button onPointerDown={e => e.stopPropagation()} onClick={() => onMarkDone(task.id)} aria-label="Mark done"
                    className="shrink-0 rounded-md p-0.5 text-gray-300 opacity-0 transition-opacity hover:bg-emerald-50 hover:text-emerald-600 group-hover:opacity-100">
                    <CheckCircle2 size={16} />
                  </button>
                </div>
                <div onPointerDown={e => beginDrag(e, task.id, 'task', 'resize', start, dur)}
                  className="absolute inset-x-0 bottom-0 flex h-2.5 cursor-ns-resize items-end justify-center opacity-0 group-hover:opacity-100" style={{ touchAction: 'none' }}>
                  <span className="mb-0.5 h-1 w-6 rounded-full" style={{ background: color }} />
                </div>
              </div>
            );
          })}

          {/* Now marker */}
          {nowVisible && (
            <div className="pointer-events-none absolute left-0 right-0 z-10" style={{ top: yFor(nowMin) }}>
              <div className="relative h-px bg-red-500">
                <span className="absolute -left-0.5 -top-[3px] h-[7px] w-[7px] rounded-full bg-red-500" />
                <span className="absolute right-1 -top-[7px] rounded bg-red-500 px-1 text-[8.5px] font-bold text-white">now</span>
              </div>
            </div>
          )}
        </div>
      </div>
      )}

      {/* Didn't-fit list */}
      {unscheduled.length > 0 && (
        <div>
          <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-amber-700">
            <MoveRight size={12} /> Couldn&rsquo;t fit today ({unscheduled.length})
          </p>
          <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
            {unscheduled.map(({ task, bucket }) => (
              <div key={task.id} className="flex items-center gap-2 rounded-lg border border-gray-100 bg-white px-3 py-2 group">
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: BUCKET_COLOR[bucket] }} />
                <button onClick={() => onOpenTask(task)} className="min-w-0 flex-1 text-left">
                  <p className="truncate text-[12px] font-semibold text-gray-800">{task.title}</p>
                  <p className="truncate text-[10.5px] text-gray-500">{task.is_internal ? 'Internal' : (task.client?.name ?? '—')}</p>
                </button>
                <button onClick={() => onMarkDone(task.id)} aria-label="Mark done"
                  className="shrink-0 rounded-md p-1 text-gray-300 hover:bg-emerald-50 hover:text-emerald-600">
                  <CheckCircle2 size={15} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {customs.length === 0 && blocks.length > 0 && (
        <p className="flex items-center gap-1 text-[11px] text-gray-400">
          <Plus size={11} /> Tip: click an empty slot on the timeline to block out focus time.
        </p>
      )}
    </div>
  );
}
