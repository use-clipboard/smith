'use client';

import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, CalendarClock, MoveRight } from 'lucide-react';
import { buildDayPlan, DAY_BUCKETS, type DayBucketKey } from '@/lib/tasks/dayPlan';
import { todayIso } from '@/lib/timesheets/format';
import type { Task } from '@/types';

// Stage B day-planner: the user's tasks auto-scheduled into today's working hours
// AROUND their Google Calendar events (fixed blocks), starting from "now" (never
// in the past). Read-only schedule + mark-done for now; drag/resize/insert next.

const DAY_START = 8;    // 08:00
const DAY_END = 19;     // 19:00
const HOURS = DAY_END - DAY_START;
const PX_PER_HOUR = 60;
const TIMELINE_H = HOURS * PX_PER_HOUR;
const SNAP = 15;

interface CalEvent { id: string; title: string; startHHmm: string; minutes: number }
interface Busy { start: number; end: number }

const BUCKET_COLOR: Record<DayBucketKey, string> = Object.fromEntries(DAY_BUCKETS.map(b => [b.key, b.color])) as Record<DayBucketKey, string>;
const BUCKET_LABEL: Record<DayBucketKey, string> = Object.fromEntries(DAY_BUCKETS.map(b => [b.key, b.label])) as Record<DayBucketKey, string>;

const parseMin = (hhmm: string): number => { const [h, m] = (hhmm || '').split(':').map(Number); return (h || 0) * 60 + (m || 0); };
const minToHHMM = (m: number): string => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(Math.round(m) % 60).padStart(2, '0')}`;
const yFor = (min: number): number => ((min - DAY_START * 60) / (HOURS * 60)) * TIMELINE_H;
function fmtDur(min: number): string { const h = Math.floor(min / 60), m = min % 60; return h ? (m ? `${h}h ${m}m` : `${h}h`) : `${m}m`; }

// Rough per-task effort: 25 min per remaining team step (client-waiting steps
// don't cost the user time), clamped 30m–3h. Task steps don't carry explicit
// minute estimates, so this is a heuristic.
function estimateMinutes(t: Task): number {
  const remaining = (t.steps ?? []).filter(s => !s.is_client_step && s.status !== 'complete' && s.status !== 'skipped').length;
  return Math.min(Math.max(remaining * 25, 30), 180);
}

/** Earliest start ≥ from where [start, start+dur] clears every busy interval and
 *  the working day. Null if it can't fit before DAY_END. `busy` sorted by start. */
function nextFreeStart(from: number, dur: number, busy: Busy[]): number | null {
  let start = Math.max(from, DAY_START * 60);
  for (let guard = 0; guard < 200; guard++) {
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
  // Recomputed each render open; fine for a plan the user opens fresh.
  const nowMin = useMemo(() => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); }, []);

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

  const { events, scheduled, unscheduled, startFrom } = useMemo(() => {
    const plan = buildDayPlan(tasks, userId);
    const queue: { task: Task; bucket: DayBucketKey }[] = [];
    for (const b of DAY_BUCKETS) for (const t of plan[b.key]) queue.push({ task: t, bucket: b.key });

    const events = calEvents
      .map(e => ({ ...e, start: parseMin(e.startHHmm), end: parseMin(e.startHHmm) + e.minutes }))
      .filter(e => e.end > DAY_START * 60 && e.start < DAY_END * 60);

    const busy: Busy[] = events.map(e => ({ start: e.start, end: e.end })).sort((a, b) => a.start - b.start);
    const startFrom = Math.max(Math.ceil(nowMin / SNAP) * SNAP, DAY_START * 60);

    const scheduled: { task: Task; bucket: DayBucketKey; start: number; dur: number }[] = [];
    const unscheduled: { task: Task; bucket: DayBucketKey }[] = [];
    let cursor = startFrom;
    for (const item of queue) {
      const dur = estimateMinutes(item.task);
      const slot = nextFreeStart(Math.max(cursor, startFrom), dur, busy);
      if (slot == null) { unscheduled.push(item); continue; }
      scheduled.push({ ...item, start: slot, dur });
      busy.push({ start: slot, end: slot + dur });
      busy.sort((a, b) => a.start - b.start);
      cursor = slot + dur;
    }
    return { events, scheduled, unscheduled, startFrom };
  }, [tasks, userId, calEvents, nowMin]);

  const plannedMins = scheduled.reduce((n, s) => n + s.dur, 0);
  const nowVisible = nowMin >= DAY_START * 60 && nowMin <= DAY_END * 60;
  const dayOver = startFrom + 30 > DAY_END * 60; // little room left today

  return (
    <div className="space-y-4">
      {/* Summary line */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px]">
        <span className="font-semibold text-gray-700">{fmtDur(plannedMins)} of work planned</span>
        {events.length > 0 && (
          <span className="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-2 py-0.5 font-semibold text-indigo-600">
            <CalendarClock size={12} /> around {events.length} meeting{events.length === 1 ? '' : 's'}
          </span>
        )}
        {unscheduled.length > 0 && (
          <span className="rounded-full bg-amber-50 px-2 py-0.5 font-semibold text-amber-700">{unscheduled.length} didn&rsquo;t fit</span>
        )}
        <span className="ml-auto text-gray-400">planned from {minToHHMM(startFrom)}</span>
      </div>

      {dayOver && scheduled.length === 0 ? (
        <p className="rounded-xl bg-gray-50 px-4 py-3 text-[12.5px] text-gray-500">
          Your working day&rsquo;s nearly done — nothing left to slot in. Outstanding work is listed below.
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
          <div className="relative flex-1 rounded-xl border border-gray-100 bg-gray-50/40">
            {Array.from({ length: HOURS }, (_, i) => (
              <div key={i} className="absolute left-0 right-0 border-t border-dashed border-black/[0.05]" style={{ top: (i / HOURS) * TIMELINE_H }} />
            ))}

            {/* Calendar events — fixed meeting blocks */}
            {events.map(ev => {
              const top = Math.max(0, yFor(ev.start));
              const h = Math.max(18, (ev.minutes / (HOURS * 60)) * TIMELINE_H);
              return (
                <div key={ev.id} className="absolute left-1.5 right-1.5 overflow-hidden rounded-lg border border-dashed border-indigo-300 bg-indigo-50/80 px-2 py-1"
                  style={{ top, height: h }}>
                  <p className="truncate text-[11px] font-semibold text-indigo-900">{ev.title}</p>
                  {h > 30 && <p className="truncate text-[10px] text-indigo-500">{ev.startHHmm} · {fmtDur(ev.minutes)}</p>}
                </div>
              );
            })}

            {/* Task blocks */}
            {scheduled.map(({ task, bucket, start, dur }) => {
              const top = Math.max(0, yFor(start));
              const h = Math.max(22, (dur / (HOURS * 60)) * TIMELINE_H);
              const color = BUCKET_COLOR[bucket];
              return (
                <div key={task.id} className="group absolute left-1.5 right-1.5 overflow-hidden rounded-lg px-2.5 py-1.5 shadow-sm"
                  style={{ top, height: h, background: `${color}1f`, borderLeft: `3px solid ${color}` }}>
                  <div className="flex items-start gap-2">
                    <button onClick={() => onOpenTask(task)} className="min-w-0 flex-1 text-left">
                      <p className="truncate text-[12px] font-semibold text-gray-800">{task.title}</p>
                      {h > 34 && (
                        <p className="truncate text-[10.5px] text-gray-500">
                          {minToHHMM(start)}–{minToHHMM(start + dur)} · {task.is_internal ? 'Internal' : (task.client?.name ?? '—')}
                        </p>
                      )}
                      {h > 52 && <p className="mt-0.5 text-[9.5px] font-semibold uppercase tracking-wide" style={{ color }}>{BUCKET_LABEL[bucket]}</p>}
                    </button>
                    <button onClick={() => onMarkDone(task.id)} aria-label="Mark done"
                      className="shrink-0 rounded-md p-0.5 text-gray-300 opacity-0 transition-opacity hover:bg-emerald-50 hover:text-emerald-600 group-hover:opacity-100">
                      <CheckCircle2 size={16} />
                    </button>
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
    </div>
  );
}
