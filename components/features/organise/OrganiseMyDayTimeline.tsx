'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, CalendarClock, MoveRight, RotateCcw, Plus, X, PlayCircle, Clock3, AlertTriangle, PauseCircle } from 'lucide-react';
import { buildDayPlan, dayPlanTaskCount, TIER_META, CHASE_COLOR } from '@/lib/tasks/dayPlan';
import { todayIso } from '@/lib/timesheets/format';
import type { OrganiseSettings } from '@/lib/tasks/organiseSettings';
import type { Task } from '@/types';

// The day-planner: admin quick-wins + the user's tasks auto-scheduled into their
// working hours AROUND calendar meetings, lunch and an end-of-day wrap, from now.
// Hand-editable (drag / resize / insert / re-plan); a live banner says what's on
// now. All edits are client-side / ephemeral (rebuilt each open).

const PX_PER_HOUR = 56;
const SNAP = 15;

export interface AdminItem { key: string; label: string; count: number; minutes: number; color: string; onOpen: () => void }
interface Busy { start: number; end: number }
interface CustomBlock { id: string; label: string; start: number; dur: number }
type DragState = { id: string; mode: 'move' | 'resize'; deltaMin: number } | null;

interface PlanItem {
  id: string;
  kind: 'admin' | 'task' | 'chase';
  label: string;
  sub?: string;
  minutes: number;
  color: string;
  task?: Task;
  onOpen: () => void;
  onDone?: () => void;
}

const minToHHMM = (m: number): string => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(Math.round(m) % 60).padStart(2, '0')}`;
const parseMin = (hhmm: string): number => { const [h, m] = (hhmm || '').split(':').map(Number); return (h || 0) * 60 + (m || 0); };
function fmtDur(min: number): string { const h = Math.floor(min / 60), m = min % 60; return h ? (m ? `${h}h ${m}m` : `${h}h`) : `${m}m`; }

function estimateMinutes(t: Task): number {
  const remaining = (t.steps ?? []).filter(s => !s.is_client_step && s.status !== 'complete' && s.status !== 'skipped').length;
  return Math.min(Math.max(remaining * 25, 30), 180);
}

interface CalEvent { id: string; title: string; startHHmm: string; minutes: number }

interface Props {
  tasks: Task[];
  userId: string;
  adminItems: AdminItem[];
  settings: OrganiseSettings;
  onOpenTask: (t: Task) => void;
  onMarkDone: (id: string) => void;
  onOpenTasks: () => void;   // chase block → open the Tasks tool
}

export default function OrganiseMyDayTimeline({ tasks, userId, adminItems, settings, onOpenTask, onMarkDone, onOpenTasks }: Props) {
  const [calEvents, setCalEvents] = useState<CalEvent[]>([]);
  const [startOverride, setStartOverride] = useState<Record<string, number>>({});
  const [durOverride, setDurOverride] = useState<Record<string, number>>({});
  const [customs, setCustoms] = useState<CustomBlock[]>([]);
  const [drag, setDrag] = useState<DragState>(null);
  const customSeq = useRef(0);
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

  // The ordered work queue: admin quick-wins → task tiers → one chase block.
  const { queue, waitingCount, chaseCount } = useMemo(() => {
    const plan = buildDayPlan(tasks, userId);
    const q: PlanItem[] = [];
    for (const a of adminItems) {
      if (a.count <= 0) continue;
      q.push({ id: `admin-${a.key}`, kind: 'admin', label: a.label, sub: `${a.count}`, minutes: a.minutes, color: a.color, onOpen: a.onOpen });
    }
    for (const m of TIER_META) for (const t of plan.tierTasks[m.tier]) {
      q.push({ id: t.id, kind: 'task', label: t.title, sub: t.is_internal ? 'Internal' : (t.client?.name ?? '—'),
        minutes: estimateMinutes(t), color: m.color, task: t, onOpen: () => onOpenTask(t), onDone: () => onMarkDone(t.id) });
    }
    if (plan.chase.length > 0) {
      q.push({ id: 'chase', kind: 'chase', label: 'Investigate / chase overdue', sub: `${plan.chase.length} overdue`,
        minutes: Math.min(45, 15 + plan.chase.length * 2), color: CHASE_COLOR, onOpen: onOpenTasks });
    }
    return { queue: q, waitingCount: plan.waiting.length, chaseCount: plan.chase.length, taskCount: dayPlanTaskCount(plan) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks, userId, adminItems]);

  // Display range covers the working day + any early/late meeting.
  const { events, dispStart, dispEnd } = useMemo(() => {
    const events = calEvents
      .map(e => ({ ...e, start: parseMin(e.startHHmm), end: parseMin(e.startHHmm) + e.minutes }))
      .filter(e => e.minutes > 0);
    const mins = [settings.workStartMin, settings.workEndMin, ...events.flatMap(e => [e.start, e.end])];
    if (settings.lunchStartMin != null) mins.push(settings.lunchStartMin, settings.lunchStartMin + settings.lunchMinutes);
    return { events, dispStart: Math.floor(Math.min(...mins) / 60) * 60, dispEnd: Math.ceil(Math.max(...mins) / 60) * 60 };
  }, [calEvents, settings]);

  const TIMELINE_H = ((dispEnd - dispStart) / 60) * PX_PER_HOUR;
  const PX_PER_MIN = PX_PER_HOUR / 60;
  const yFor = (m: number) => (m - dispStart) * PX_PER_MIN;
  const hFor = (m: number) => m * PX_PER_MIN;
  const clampStart = (start: number, dur: number) => Math.max(dispStart, Math.min(start, settings.workEndMin - dur));
  const clampDur = (dur: number, start: number) => Math.max(SNAP, Math.min(dur, dispEnd - start));

  // Fixed structural blocks the schedule flows around.
  const lunch = settings.lunchStartMin != null && settings.lunchMinutes > 0
    ? { start: settings.lunchStartMin, dur: settings.lunchMinutes } : null;
  const wrap = settings.wrapMinutes > 0
    ? { start: settings.workEndMin - settings.wrapMinutes, dur: settings.wrapMinutes } : null;

  // Auto-schedule the (non-pinned) queue around everything fixed, with a buffer.
  const { scheduled, unscheduled, startFrom } = useMemo(() => {
    const busy: Busy[] = [
      ...events.map(e => ({ start: e.start, end: e.end })),
      ...customs.map(c => ({ start: c.start, end: c.start + c.dur })),
    ];
    if (lunch) busy.push({ start: lunch.start, end: lunch.start + lunch.dur });
    if (wrap) busy.push({ start: wrap.start, end: wrap.start + wrap.dur });

    const durOf = (it: PlanItem) => durOverride[it.id] ?? it.minutes;
    const scheduled: { item: PlanItem; start: number; dur: number; pinned: boolean }[] = [];
    for (const it of queue) {
      const ov = startOverride[it.id];
      if (ov == null) continue;
      const dur = durOf(it);
      scheduled.push({ item: it, start: ov, dur, pinned: true });
      busy.push({ start: ov, end: ov + dur });
    }
    busy.sort((a, b) => a.start - b.start);

    const startFrom = Math.max(Math.ceil(openMin / SNAP) * SNAP, settings.workStartMin);
    const findSlot = (from: number, dur: number): number | null => {
      let start = Math.max(from, settings.workStartMin);
      for (let g = 0; g < 400; g++) {
        if (start + dur > settings.workEndMin) return null;
        const clash = busy.find(b => start < b.end && start + dur > b.start);
        if (!clash) return start;
        start = Math.ceil(clash.end / SNAP) * SNAP;
      }
      return null;
    };

    const unscheduled: PlanItem[] = [];
    let cursor = startFrom;
    for (const it of queue) {
      if (startOverride[it.id] != null) continue;
      const dur = durOf(it);
      const slot = findSlot(Math.max(cursor, startFrom), dur);
      if (slot == null) { unscheduled.push(it); continue; }
      scheduled.push({ item: it, start: slot, dur, pinned: false });
      busy.push({ start: slot, end: slot + dur });
      busy.sort((a, b) => a.start - b.start);
      cursor = slot + dur + settings.bufferMinutes;
    }
    return { scheduled, unscheduled, startFrom };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queue, events, customs, startOverride, durOverride, openMin, settings]);

  const hasEdits = Object.keys(startOverride).length > 0 || Object.keys(durOverride).length > 0 || customs.length > 0;
  const plannedMins = scheduled.reduce((n, s) => n + s.dur, 0);
  const nowVisible = nowMin >= dispStart && nowMin <= dispEnd;
  const nothing = scheduled.length === 0 && customs.length === 0;

  // Live "on now / up next" across everything on the day.
  const bannerItems = [
    ...scheduled.map(s => ({ start: s.start, end: s.start + s.dur, title: s.item.label, open: s.item.onOpen })),
    ...events.map(e => ({ start: e.start, end: e.end, title: e.title, open: null as (() => void) | null })),
    ...(lunch ? [{ start: lunch.start, end: lunch.start + lunch.dur, title: 'Lunch', open: null as (() => void) | null }] : []),
  ].sort((a, b) => a.start - b.start);
  const currentItem = bannerItems.find(i => i.start <= nowMin && nowMin < i.end) ?? null;
  const nextItem = bannerItems.find(i => i.start > nowMin) ?? null;

  // ── Pointer drag (move / resize), snapping; tap (no move) = onTap ────────────
  function beginDrag(e: React.PointerEvent, id: string, mode: 'move' | 'resize', baseStart: number, baseDur: number, isTask: boolean, isCustom: boolean, onTap?: () => void) {
    e.preventDefault();
    e.stopPropagation();
    const swallow = (ce: Event) => { ce.stopPropagation(); ce.stopImmediatePropagation(); };
    window.addEventListener('click', swallow, { capture: true, once: true });
    const startY = e.clientY;
    let deltaMin = 0, moved = false;
    setDrag({ id, mode, deltaMin: 0 });
    const onMove = (ev: PointerEvent) => {
      const dPx = ev.clientY - startY;
      deltaMin = Math.round(dPx / PX_PER_MIN / SNAP) * SNAP;
      if (Math.abs(dPx) > 4) moved = true;
      setDrag({ id, mode, deltaMin });
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      setDrag(null);
      if (!moved) { onTap?.(); return; }
      if (mode === 'move') {
        const ns = clampStart(baseStart + deltaMin, baseDur);
        if (isCustom) setCustoms(cs => cs.map(c => (c.id === id ? { ...c, start: ns } : c)));
        else setStartOverride(o => ({ ...o, [id]: ns }));
      } else {
        const nd = clampDur(baseDur + deltaMin, baseStart);
        if (isCustom) setCustoms(cs => cs.map(c => (c.id === id ? { ...c, dur: nd } : c)));
        else setDurOverride(o => ({ ...o, [id]: nd }));
      }
      void isTask;
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }

  function addBlockAt(offsetY: number) {
    const min = Math.round((dispStart + (offsetY / PX_PER_MIN)) / SNAP) * SNAP;
    customSeq.current += 1;
    setCustoms(cs => [...cs, { id: `focus-${customSeq.current}`, label: 'Focus time', start: clampStart(min, 30), dur: 30 }]);
  }
  function resetPlan() { setStartOverride({}); setDurOverride({}); setCustoms([]); }
  const previewFor = (id: string, start: number, dur: number) => {
    if (!drag || drag.id !== id) return { start, dur };
    return drag.mode === 'move' ? { start: clampStart(start + drag.deltaMin, dur), dur } : { start, dur: clampDur(dur + drag.deltaMin, start) };
  };

  return (
    <div className="space-y-4">
      {/* Next-task banner */}
      {(currentItem || nextItem) && (
        <div className={`flex items-center gap-2.5 rounded-xl px-3.5 py-2.5 ${currentItem ? 'text-white' : 'bg-indigo-50 text-indigo-800'}`}
          style={currentItem ? { background: 'linear-gradient(135deg,#4f46e5,#7c3aed)' } : undefined}>
          {currentItem ? <PlayCircle size={17} className="shrink-0" /> : <Clock3 size={16} className="shrink-0 text-indigo-500" />}
          <p className="min-w-0 flex-1 text-[12.5px] leading-snug">
            {currentItem ? (
              <>On now until {minToHHMM(currentItem.end)} — <span className="font-bold">{currentItem.title}</span>
                {nextItem && <span className="opacity-80"> · next {minToHHMM(nextItem.start)}: {nextItem.title}</span>}</>
            ) : (
              <>Up next at {minToHHMM(nextItem!.start)} — <span className="font-bold">{nextItem!.title}</span></>
            )}
          </p>
          {currentItem?.open && (
            <button onClick={currentItem.open} className="shrink-0 rounded-lg bg-white/20 px-2.5 py-1 text-[11px] font-semibold hover:bg-white/30">Open</button>
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
        {unscheduled.length > 0 && <span className="rounded-full bg-amber-50 px-2 py-0.5 font-semibold text-amber-700">{unscheduled.length} didn&rsquo;t fit</span>}
        <span className="ml-auto hidden text-gray-400 sm:inline">drag to move · edge to resize · click empty time to add</span>
        {hasEdits && (
          <button onClick={resetPlan} className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-2 py-1 font-semibold text-gray-600 hover:bg-gray-50">
            <RotateCcw size={12} /> Re-plan
          </button>
        )}
      </div>

      {nothing ? (
        <p className="rounded-xl bg-gray-50 px-4 py-3 text-[12.5px] text-gray-500">
          {startFrom + SNAP >= settings.workEndMin
            ? 'Your working day’s nearly done — nothing left to slot in. Outstanding work is listed below.'
            : 'Nothing to schedule into the day right now.'}
        </p>
      ) : (
        <div className="flex" style={{ height: TIMELINE_H }}>
          {/* Hour gutter */}
          <div className="relative w-11 shrink-0">
            {Array.from({ length: (dispEnd - dispStart) / 60 + 1 }, (_, i) => (
              <div key={i} className="absolute right-2 -translate-y-1/2 text-[10px] tabular-nums text-gray-400" style={{ top: i * PX_PER_HOUR }}>
                {String(dispStart / 60 + i).padStart(2, '0')}:00
              </div>
            ))}
          </div>

          {/* Timeline column */}
          <div className="relative flex-1 rounded-xl border border-gray-100 bg-gray-50/40"
            onClick={e => { if (e.target === e.currentTarget) addBlockAt(e.nativeEvent.offsetY); }}>
            {Array.from({ length: (dispEnd - dispStart) / 60 }, (_, i) => (
              <div key={i} className="pointer-events-none absolute left-0 right-0 border-t border-dashed border-black/[0.05]" style={{ top: i * PX_PER_HOUR }} />
            ))}

            {/* Lunch + wrap (structural) */}
            {lunch && (
              <div className="pointer-events-none absolute left-1.5 right-1.5 overflow-hidden rounded-lg border border-amber-200 bg-amber-50/70 px-2 py-1"
                style={{ top: Math.max(0, yFor(lunch.start)), height: Math.max(16, hFor(lunch.dur)) }}>
                <p className="text-[11px] font-semibold text-amber-800">Lunch</p>
              </div>
            )}
            {wrap && (
              <div className="pointer-events-none absolute left-1.5 right-1.5 overflow-hidden rounded-lg border border-slate-200 bg-slate-100/70 px-2 py-1"
                style={{ top: Math.max(0, yFor(wrap.start)), height: Math.max(16, hFor(wrap.dur)) }}>
                <p className="text-[11px] font-semibold text-slate-600">Wrap up · plan tomorrow</p>
              </div>
            )}

            {/* Calendar meetings */}
            {events.map(ev => (
              <div key={ev.id} className="pointer-events-none absolute left-1.5 right-1.5 overflow-hidden rounded-lg border border-dashed border-indigo-300 bg-indigo-50/80 px-2 py-1"
                style={{ top: Math.max(0, yFor(ev.start)), height: Math.max(18, hFor(ev.minutes)) }}>
                <p className="truncate text-[11px] font-semibold text-indigo-900">{ev.title}</p>
                {hFor(ev.minutes) > 30 && <p className="truncate text-[10px] text-indigo-500">{ev.startHHmm} · {fmtDur(ev.minutes)}</p>}
              </div>
            ))}

            {/* Custom focus blocks */}
            {customs.map(c => {
              const p = previewFor(c.id, c.start, c.dur); const h = Math.max(22, hFor(p.dur));
              const dragging = drag?.id === c.id;
              return (
                <div key={c.id} onPointerDown={e => beginDrag(e, c.id, 'move', c.start, c.dur, false, true)}
                  className={`group absolute left-1.5 right-1.5 overflow-hidden rounded-lg border border-slate-300 bg-slate-100 px-2.5 py-1.5 ${dragging ? 'z-20 cursor-grabbing ring-2 ring-slate-300' : 'cursor-grab'}`}
                  style={{ top: Math.max(0, yFor(p.start)), height: h, touchAction: 'none' }}>
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[12px] font-semibold text-slate-700">{c.label}</p>
                      {h > 34 && <p className="truncate text-[10.5px] text-slate-400">{minToHHMM(p.start)}–{minToHHMM(p.start + p.dur)}</p>}
                    </div>
                    <button onPointerDown={e => e.stopPropagation()} onClick={() => setCustoms(cs => cs.filter(x => x.id !== c.id))} aria-label="Remove block"
                      className="shrink-0 rounded-md p-0.5 text-slate-300 opacity-0 hover:bg-rose-50 hover:text-rose-500 group-hover:opacity-100"><X size={15} /></button>
                  </div>
                  <div onPointerDown={e => beginDrag(e, c.id, 'resize', c.start, c.dur, false, true)}
                    className="absolute inset-x-0 bottom-0 flex h-2.5 cursor-ns-resize items-end justify-center opacity-0 group-hover:opacity-100" style={{ touchAction: 'none' }}>
                    <span className="mb-0.5 h-1 w-6 rounded-full bg-slate-400" />
                  </div>
                </div>
              );
            })}

            {/* Scheduled blocks (admin / task / chase) */}
            {scheduled.map(({ item, start, dur, pinned }) => {
              const p = previewFor(item.id, start, dur); const h = Math.max(22, hFor(p.dur));
              const color = item.color; const dragging = drag?.id === item.id;
              return (
                <div key={item.id} onPointerDown={e => beginDrag(e, item.id, 'move', start, dur, item.kind === 'task', false, item.onOpen)}
                  className={`group absolute left-1.5 right-1.5 overflow-hidden rounded-lg px-2.5 py-1.5 shadow-sm ${dragging ? 'z-20 cursor-grabbing ring-2' : 'cursor-grab'}`}
                  style={{ top: Math.max(0, yFor(p.start)), height: h, background: `${color}1f`, borderLeft: `3px solid ${color}`, touchAction: 'none', ...(dragging ? { boxShadow: `0 0 0 2px ${color}55` } : {}) }}>
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-1 truncate text-[12px] font-semibold text-gray-800">
                        {item.kind === 'admin' && <CheckCircle2 size={12} style={{ color }} className="shrink-0" />}
                        {item.kind === 'chase' && <AlertTriangle size={12} style={{ color }} className="shrink-0" />}
                        <span className="truncate">{item.label}{item.kind === 'admin' && item.sub ? ` (${item.sub})` : ''}</span>
                      </p>
                      {h > 34 && (
                        <p className="truncate text-[10.5px] text-gray-500">
                          {minToHHMM(p.start)}–{minToHHMM(p.start + p.dur)}{item.kind !== 'admin' && item.sub ? ` · ${item.sub}` : ''}{pinned ? ' · moved' : ''}
                        </p>
                      )}
                    </div>
                    {item.onDone && (
                      <button onPointerDown={e => e.stopPropagation()} onClick={item.onDone} aria-label="Mark done"
                        className="shrink-0 rounded-md p-0.5 text-gray-300 opacity-0 transition-opacity hover:bg-emerald-50 hover:text-emerald-600 group-hover:opacity-100"><CheckCircle2 size={16} /></button>
                    )}
                  </div>
                  <div onPointerDown={e => beginDrag(e, item.id, 'resize', start, dur, item.kind === 'task', false)}
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
            {unscheduled.map(it => (
              <div key={it.id} className="flex items-center gap-2 rounded-lg border border-gray-100 bg-white px-3 py-2 group">
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: it.color }} />
                <button onClick={it.onOpen} className="min-w-0 flex-1 text-left">
                  <p className="truncate text-[12px] font-semibold text-gray-800">{it.label}</p>
                  {it.sub && <p className="truncate text-[10.5px] text-gray-500">{it.sub}</p>}
                </button>
                {it.onDone && (
                  <button onClick={it.onDone} aria-label="Mark done" className="shrink-0 rounded-md p-1 text-gray-300 hover:bg-emerald-50 hover:text-emerald-600"><CheckCircle2 size={15} /></button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Footnotes */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-gray-400">
        {waitingCount > 0 && (
          <span className="inline-flex items-center gap-1"><PauseCircle size={12} /> {waitingCount} waiting on clients — not scheduled</span>
        )}
        {chaseCount > 0 && (
          <span className="inline-flex items-center gap-1"><AlertTriangle size={12} className="text-red-400" /> {chaseCount} overdue grouped into the chase block</span>
        )}
        {customs.length === 0 && !nothing && (
          <span className="inline-flex items-center gap-1"><Plus size={11} /> Click an empty slot to block out focus time</span>
        )}
      </div>
    </div>
  );
}
