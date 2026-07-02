'use client';

import { useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Plus, Play, CalendarDays, Lock, Send, CheckCircle2, RotateCcw, Clock3 } from 'lucide-react';
import type { TimeEntry } from '@/lib/timesheets/types';
import { useTimesheets } from '../TimesheetsProvider';
import { TYPE_COLORS } from '@/lib/timesheets/palette';
import {
  weekDates, startOfWeek, addDays, todayIso, fmtDuration, fmtHours, fmtDateUK, fmtWeekday,
} from '@/lib/timesheets/format';
import { totals } from '@/lib/timesheets/compute';
import { GlassCard, TypeBadge } from '../shared/ui';
import EntryModal from '../shared/EntryModal';
import TimerStartModal from '../timer/TimerStartModal';

const DAY_START = 7;   // 07:00
const DAY_END = 20;    // 20:00
const HOURS = DAY_END - DAY_START;
const PX_PER_HOUR = 56;
const TIMELINE_H = HOURS * PX_PER_HOUR;

const parseMin = (hhmm: string): number => {
  if (!hhmm || hhmm === '—') return DAY_START * 60;
  const [h, m] = hhmm.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
};

const minToHHMM = (m: number): string =>
  `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(Math.round(m) % 60).padStart(2, '0')}`;

const clampStart = (start: number, minutes: number): number =>
  Math.max(DAY_START * 60, Math.min(start, DAY_END * 60 - minutes));
const clampDur = (minutes: number, start: number): number =>
  Math.max(15, Math.min(minutes, DAY_END * 60 - start));

/** Assign overlapping blocks to side-by-side lanes. */
function packLanes(items: TimeEntry[]): { entry: TimeEntry; lane: number; lanes: number }[] {
  const sorted = [...items].sort((a, b) => parseMin(a.start) - parseMin(b.start));
  const laneEnds: number[] = [];
  const placed = sorted.map(entry => {
    const start = parseMin(entry.start);
    const end = start + entry.minutes;
    let lane = laneEnds.findIndex(e => e <= start);
    if (lane === -1) { lane = laneEnds.length; laneEnds.push(end); }
    else laneEnds[lane] = end;
    return { entry, start, end, lane };
  });
  const lanes = Math.max(1, laneEnds.length);
  return placed.map(p => ({ entry: p.entry, lane: p.lane, lanes }));
}

export default function MyTimesheet() {
  const { entries, meId, updateEntry, weekStatusFor, submitWeek, withdrawWeek, weekStatuses } = useTimesheets();
  const [selectedDay, setSelectedDay] = useState(todayIso());
  const [editing, setEditing] = useState<TimeEntry | null>(null);
  const [adding, setAdding] = useState<string | null>(null); // holds date to add on
  const [startingTimer, setStartingTimer] = useState(false);
  const [dragPreview, setDragPreview] = useState<{ id: string; mode: 'move' | 'resize'; deltaMin: number } | null>(null);
  const [dropDay, setDropDay] = useState<string | null>(null); // week-strip chip being hovered mid-drag
  const weekLockedRef = useRef(false);

  // Pointer-driven drag: move a block (change start, or drop onto another day),
  // or resize it (change duration). Snaps to 15 minutes. A press without
  // movement opens the editor.
  function beginDrag(e: React.PointerEvent, entry: TimeEntry, mode: 'move' | 'resize') {
    if (weekLockedRef.current) return; // locked week — entries are read-only
    e.preventDefault();
    e.stopPropagation();
    const startY = e.clientY;
    const originStart = parseMin(entry.start);
    const originMinutes = entry.minutes;
    const pxPerMin = TIMELINE_H / (HOURS * 60);
    let deltaMin = 0;
    let moved = false;
    let overDay: string | null = null;

    setDragPreview({ id: entry.id, mode, deltaMin: 0 });
    const onMove = (ev: PointerEvent) => {
      const dPx = ev.clientY - startY;
      deltaMin = Math.round(dPx / pxPerMin / 15) * 15;
      if (Math.abs(dPx) > 4) moved = true;
      if (mode === 'move') {
        // Dropping onto a different day chip moves the entry to that date.
        const el = document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null;
        const chip = el?.closest('[data-ts-day]') as HTMLElement | null;
        const d = chip?.getAttribute('data-ts-day') ?? null;
        overDay = d && d !== entry.date ? d : null;
        setDropDay(overDay);
        if (d) moved = true;
      }
      setDragPreview({ id: entry.id, mode, deltaMin });
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      setDragPreview(null);
      setDropDay(null);
      if (!moved) { setEditing(entry); return; }
      if (mode === 'move') {
        if (overDay) {
          updateEntry(entry.id, { date: overDay });   // keep original start on the new day
          setSelectedDay(overDay);
        } else {
          updateEntry(entry.id, { start: minToHHMM(clampStart(originStart + deltaMin, originMinutes)) });
        }
      } else {
        updateEntry(entry.id, { minutes: clampDur(originMinutes + deltaMin, originStart) });
      }
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }

  const anchor = selectedDay;
  const days = weekDates(anchor);
  const weekStart = startOfWeek(anchor);
  const weekStatus = weekStatusFor(meId, weekStart);
  const locked = weekStatus === 'submitted' || weekStatus === 'approved';
  weekLockedRef.current = locked;

  const myEntries = useMemo(() => entries.filter(e => e.userId === meId), [entries, meId]);
  const dayEntries = useMemo(() => myEntries.filter(e => e.date === selectedDay), [myEntries, selectedDay]);
  const dayTotals = totals(dayEntries);
  const packed = useMemo(() => packLanes(dayEntries), [dayEntries]);

  const perDayMinutes = (iso: string) => myEntries.filter(e => e.date === iso).reduce((s, e) => s + e.minutes, 0);
  const weekMinutes = useMemo(() => {
    const set = new Set(days);
    return myEntries.filter(e => set.has(e.date)).reduce((s, e) => s + e.minutes, 0);
  }, [myEntries, days]);
  const weekNote = weekStatuses[`${meId}__${weekStart}`]?.note ?? null;

  return (
    <div className="space-y-5">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button onClick={() => setSelectedDay(addDays(weekStart, -7))} className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/70 text-[var(--text-secondary)] shadow-sm hover:bg-white"><ChevronLeft size={18} /></button>
          <div className="rounded-xl bg-white/70 px-3.5 py-1.5 text-center shadow-sm">
            <p className="text-[13px] font-semibold text-[var(--text-primary)]">Week of {fmtDateUK(weekStart)}</p>
          </div>
          <button onClick={() => setSelectedDay(addDays(weekStart, 7))} className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/70 text-[var(--text-secondary)] shadow-sm hover:bg-white"><ChevronRight size={18} /></button>
          <button onClick={() => setSelectedDay(todayIso())} className="ml-1 inline-flex items-center gap-1.5 rounded-xl bg-white/70 px-3 py-2 text-[12px] font-semibold text-[var(--text-secondary)] shadow-sm hover:bg-white"><CalendarDays size={14} /> Today</button>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setAdding(selectedDay)} disabled={locked} className="btn-secondary"><Plus size={15} /> Add entry</button>
          <button onClick={() => setStartingTimer(true)} className="btn-primary"><Play size={15} /> Start timer</button>
        </div>
      </div>

      {/* Week strip */}
      <div className="grid grid-cols-7 gap-2">
        {days.map(iso => {
          const mins = perDayMinutes(iso);
          const isSel = iso === selectedDay;
          const isToday = iso === todayIso();
          const isDrop = dropDay === iso;
          return (
            <button
              key={iso}
              data-ts-day={iso}
              onClick={() => setSelectedDay(iso)}
              className={`rounded-2xl border p-2.5 text-center transition-all ${
                isDrop ? 'border-[var(--accent)] bg-[var(--accent)]/15 ring-2 ring-[var(--accent)]/40 scale-105'
                : isSel ? 'border-[var(--accent)] bg-[var(--accent)]/8 shadow-sm'
                : 'border-white/60 bg-white/60 hover:bg-white'
              }`}
            >
              <p className={`text-[10.5px] font-semibold uppercase ${isToday ? 'text-[var(--accent)]' : 'text-[var(--text-muted)]'}`}>{fmtWeekday(iso)}</p>
              <p className={`text-[17px] font-bold ${isSel ? 'text-[var(--accent)]' : 'text-[var(--text-primary)]'}`}>{iso.slice(-2)}</p>
              <p className="mt-0.5 text-[10px] text-[var(--text-muted)]">{mins ? fmtHours(mins) : '—'}</p>
            </button>
          );
        })}
      </div>

      {/* Week submission / approval status */}
      <div className={`flex flex-wrap items-center justify-between gap-3 rounded-2xl border px-4 py-2.5 ${
        weekStatus === 'approved' ? 'border-emerald-200 bg-emerald-50'
        : weekStatus === 'submitted' ? 'border-amber-200 bg-amber-50'
        : weekStatus === 'rejected' ? 'border-rose-200 bg-rose-50'
        : 'border-white/60 bg-white/60'
      }`}>
        <div className="flex items-center gap-2.5">
          <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${
            weekStatus === 'approved' ? 'bg-emerald-100 text-emerald-600'
            : weekStatus === 'submitted' ? 'bg-amber-100 text-amber-600'
            : weekStatus === 'rejected' ? 'bg-rose-100 text-rose-600'
            : 'bg-[var(--accent)]/10 text-[var(--accent)]'
          }`}>
            {weekStatus === 'approved' ? <CheckCircle2 size={16} />
              : weekStatus === 'submitted' ? <Clock3 size={16} />
              : weekStatus === 'rejected' ? <RotateCcw size={16} />
              : <Send size={16} />}
          </div>
          <div>
            <p className="text-[13px] font-bold text-[var(--text-primary)]">
              {weekStatus === 'approved' ? 'Week approved & locked'
                : weekStatus === 'submitted' ? 'Submitted — awaiting approval'
                : weekStatus === 'rejected' ? 'Changes requested — please review and resubmit'
                : 'Week open for editing'}
            </p>
            <p className="text-[11px] text-[var(--text-muted)]">
              Week of {fmtDateUK(weekStart)} · {fmtHours(weekMinutes)} logged{weekNote ? ` · “${weekNote}”` : ''}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {weekStatus === 'draft' && <button onClick={() => submitWeek(weekStart)} className="btn-primary"><Send size={14} /> Submit for approval</button>}
          {weekStatus === 'submitted' && <button onClick={() => withdrawWeek(weekStart)} className="btn-secondary"><RotateCcw size={14} /> Withdraw</button>}
          {weekStatus === 'rejected' && <button onClick={() => submitWeek(weekStart)} className="btn-primary"><Send size={14} /> Resubmit</button>}
          {weekStatus === 'approved' && <span className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-emerald-600"><Lock size={13} /> Locked</span>}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        {/* Timeline */}
        <GlassCard className="lg:col-span-2" padded={false}>
          <div className="flex items-center justify-between px-5 pt-4">
            <div>
              <h3 className="text-[15px] font-bold text-[var(--text-primary)]">{fmtWeekday(selectedDay)} {fmtDateUK(selectedDay)}</h3>
              <p className="text-xs text-[var(--text-muted)]">{fmtHours(dayTotals.total)} logged · {fmtHours(dayTotals.billable)} billable</p>
            </div>
            <p className="hidden text-[11px] text-[var(--text-muted)] sm:block">Drag to move · onto a day above to reschedule · edge to resize · click to edit</p>
          </div>
          <div className="p-5">
            <div className="relative flex" style={{ height: TIMELINE_H }}>
              {/* Hour gutter */}
              <div className="relative w-12 shrink-0">
                {Array.from({ length: HOURS + 1 }, (_, i) => (
                  <div key={i} className="absolute right-2 -translate-y-1/2 text-[10px] text-[var(--text-muted)]" style={{ top: (i / HOURS) * TIMELINE_H }}>
                    {String(DAY_START + i).padStart(2, '0')}:00
                  </div>
                ))}
              </div>
              {/* Grid + blocks */}
              <div
                className="relative flex-1 rounded-xl border border-black/5 bg-white/40"
                onClick={e => {
                  // Click empty space to add at that time.
                  if (locked || e.target !== e.currentTarget) return;
                  setAdding(selectedDay);
                }}
              >
                {Array.from({ length: HOURS }, (_, i) => (
                  <div key={i} className="absolute left-0 right-0 border-t border-dashed border-black/[0.05]" style={{ top: (i / HOURS) * TIMELINE_H }} />
                ))}
                {packed.map(({ entry, lane, lanes }) => {
                  const preview = dragPreview && dragPreview.id === entry.id ? dragPreview : null;
                  let startMin = parseMin(entry.start);
                  let minutes = entry.minutes;
                  if (preview) {
                    if (preview.mode === 'move') startMin = clampStart(startMin + preview.deltaMin, minutes);
                    else minutes = clampDur(minutes + preview.deltaMin, startMin);
                  }
                  const top = ((startMin - DAY_START * 60) / (HOURS * 60)) * TIMELINE_H;
                  const height = Math.max(20, (minutes / (HOURS * 60)) * TIMELINE_H);
                  const color = TYPE_COLORS[entry.type];
                  const widthPct = 100 / lanes;
                  const dragging = !!preview;
                  return (
                    <div
                      key={entry.id}
                      onPointerDown={e => beginDrag(e, entry, 'move')}
                      className={`group absolute overflow-hidden rounded-lg px-2 py-1 text-left shadow-sm ${
                        locked ? 'cursor-default'
                        : dragging ? 'z-20 cursor-grabbing ring-2 ring-[var(--accent)]/40 select-none'
                        : 'cursor-grab transition-[top,height] duration-75 hover:z-10'
                      }`}
                      style={{
                        top: Math.max(0, top),
                        height,
                        left: `calc(${lane * widthPct}% + 3px)`,
                        width: `calc(${widthPct}% - 6px)`,
                        background: `${color}1f`,
                        borderLeft: `3px solid ${color}`,
                        touchAction: 'none',
                        // While dragging, let the pointer "see through" to the
                        // day chips underneath so cross-day drops register.
                        pointerEvents: dragging ? 'none' : undefined,
                      }}
                    >
                      <p className="pointer-events-none truncate text-[11px] font-semibold text-[var(--text-primary)]">{entry.clientName}</p>
                      {height > 34 && <p className="pointer-events-none truncate text-[10px] text-[var(--text-muted)]">{entry.activity}</p>}
                      {(height > 50 || dragging) && <p className="pointer-events-none mt-0.5 text-[10px] font-medium" style={{ color }}>{minToHHMM(startMin)} · {fmtDuration(minutes)}</p>}
                      {/* Resize grip (hidden when the week is locked) */}
                      {!locked && (
                        <div
                          onPointerDown={e => beginDrag(e, entry, 'resize')}
                          className="absolute inset-x-0 bottom-0 flex h-2.5 cursor-ns-resize items-end justify-center opacity-0 transition-opacity group-hover:opacity-100"
                          style={{ touchAction: 'none' }}
                        >
                          <span className="mb-0.5 h-1 w-6 rounded-full" style={{ background: color }} />
                        </div>
                      )}
                    </div>
                  );
                })}
                {dayEntries.length === 0 && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 text-center">
                    <p className="text-sm font-medium text-[var(--text-muted)]">Nothing logged</p>
                    {locked
                      ? <p className="inline-flex items-center gap-1 text-[12px] font-medium text-[var(--text-muted)]"><Lock size={12} /> Week locked</p>
                      : <button onClick={() => setAdding(selectedDay)} className="text-[12px] font-semibold text-[var(--accent)] hover:underline">Add your first entry</button>}
                  </div>
                )}
              </div>
            </div>
          </div>
        </GlassCard>

        {/* Day summary list */}
        <GlassCard>
          <h3 className="mb-1 text-[15px] font-bold text-[var(--text-primary)]">Entries</h3>
          <p className="mb-4 text-xs text-[var(--text-muted)]">{dayEntries.length} on {fmtDateUK(selectedDay)}</p>
          <div className="space-y-2">
            {[...dayEntries].sort((a, b) => parseMin(a.start) - parseMin(b.start)).map(e => (
              <button key={e.id} onClick={() => { if (!locked) setEditing(e); }} className="flex w-full items-center gap-2.5 rounded-xl border border-black/5 bg-white/60 p-2.5 text-left transition-colors hover:bg-white">
                <span className="h-8 w-1 shrink-0 rounded-full" style={{ background: TYPE_COLORS[e.type] }} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[12px] font-semibold text-[var(--text-primary)]">{e.clientName}</p>
                  <p className="truncate text-[10.5px] text-[var(--text-muted)]">{e.start} · {e.activity}</p>
                </div>
                <span className="shrink-0 text-[12px] font-bold text-[var(--text-primary)]">{fmtDuration(e.minutes)}</span>
              </button>
            ))}
            {dayEntries.length === 0 && <p className="py-6 text-center text-sm text-[var(--text-muted)]">No entries.</p>}
          </div>
          {dayEntries.length > 0 && (
            <div className="mt-4 flex items-center justify-between border-t border-black/5 pt-3">
              <TypeBadge type="billable" />
              <span className="text-[13px] font-bold text-[var(--text-primary)]">{fmtDuration(dayTotals.total)} total</span>
            </div>
          )}
        </GlassCard>
      </div>

      {editing && <EntryModal entry={editing} onClose={() => setEditing(null)} />}
      {adding && <EntryModal defaultDate={adding} onClose={() => setAdding(null)} />}
      {startingTimer && <TimerStartModal onClose={() => setStartingTimer(false)} />}
    </div>
  );
}
