'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, CalendarClock, MoveRight, RotateCcw, Plus, X, PlayCircle, Clock3, AlertTriangle, PauseCircle, Loader2 } from 'lucide-react';
import { buildDayPlan, TIER_META, CHASE_COLOR } from '@/lib/tasks/dayPlan';
import { todayIso } from '@/lib/timesheets/format';
import type { OrganiseSettings } from '@/lib/tasks/organiseSettings';
import type { Task } from '@/types';

// The day-planner. Admin quick-wins + the user's tasks scheduled into their
// working hours AROUND calendar meetings, lunch and an end-of-day wrap, from now.
// The plan is PERSISTED per day: it survives refreshes; completed work drops off
// automatically; "Re-plan" is the only thing that regenerates and pulls in new
// work. Hand-editable (drag / resize / insert). All layout stored as blocks.

const PX_PER_HOUR = 56;
const SNAP = 15;

export interface AdminItem { key: string; label: string; count: number; minutes: number; color: string; onOpen: () => void }
interface Busy { start: number; end: number }
interface PlanItem { id: string; kind: 'admin' | 'task' | 'chase'; label: string; sub?: string; minutes: number; color: string; task?: Task; onOpen: () => void; onDone?: () => void }
/** Persisted block: identifies a queue item (by key) or a custom focus block. */
interface Block { key: string; kind: 'admin' | 'task' | 'chase' | 'custom'; start: number; dur: number; label?: string }
type DragState = { key: string; mode: 'move' | 'resize'; deltaMin: number } | null;

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
    for (const m of TIER_META) for (const t of plan.tierTasks[m.tier]) q.push({ id: t.id, kind: 'task', label: t.title, sub: t.is_internal ? 'Internal' : (t.client?.name ?? '—'), minutes: estimateMinutes(t), color: m.color, task: t, onOpen: () => onOpenTask(t), onDone: () => onMarkDone(t.id) });
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
      fetch(`/api/timesheets/calendar?date=${planDate}`).then(r => (r.ok ? r.json() : { events: [] })).then(cd => { if (live) { setCalEvents((cd.events ?? []) as CalEvent[]); setCalLoaded(true); } }).catch(() => { if (live) setCalLoaded(true); });
    }).catch(() => { if (live) setCalLoaded(true); });
    fetch(`/api/users/organise-plan?date=${planDate}`).then(r => (r.ok ? r.json() : null)).then((d: { plan?: { blocks?: Block[] } | null } | null) => {
      if (!live) return;
      if (d?.plan?.blocks) { setBlocks(d.plan.blocks); didGenerate.current = true; }
      setPlanLoaded(true);
    }).catch(() => { if (live) setPlanLoaded(true); });
    return () => { live = false; };
  }, [planDate]);

  // Display range covers the working day + any early/late meeting.
  const { events, dispStart, dispEnd } = useMemo(() => {
    const events = calEvents.map(e => ({ ...e, start: parseMin(e.startHHmm), end: parseMin(e.startHHmm) + e.minutes })).filter(e => e.minutes > 0);
    const mins = [settings.workStartMin, settings.workEndMin, ...events.flatMap(e => [e.start, e.end])];
    if (settings.lunchStartMin != null) mins.push(settings.lunchStartMin, settings.lunchStartMin + settings.lunchMinutes);
    return { events, dispStart: Math.floor(Math.min(...mins) / 60) * 60, dispEnd: Math.ceil(Math.max(...mins) / 60) * 60 };
  }, [calEvents, settings]);

  const lunch = settings.lunchStartMin != null && settings.lunchMinutes > 0 ? { start: settings.lunchStartMin, dur: settings.lunchMinutes } : null;
  const wrap = settings.wrapMinutes > 0 ? { start: settings.workEndMin - settings.wrapMinutes, dur: settings.wrapMinutes } : null;
  const fixedBusy = useMemo<Busy[]>(() => {
    const b: Busy[] = events.map(e => ({ start: e.start, end: e.end }));
    if (lunch) b.push({ start: lunch.start, end: lunch.start + lunch.dur });
    if (wrap) b.push({ start: wrap.start, end: wrap.start + wrap.dur });
    return b.sort((a, z) => a.start - z.start);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events, settings]);

  // Generate a fresh block layout from the current queue (+ keep custom blocks).
  const generate = (existingCustoms: Block[], fromMin: number): Block[] => {
    const busy: Busy[] = [...fixedBusy, ...existingCustoms.map(c => ({ start: c.start, end: c.start + c.dur }))].sort((a, z) => a.start - z.start);
    const startFrom = Math.max(Math.ceil(fromMin / SNAP) * SNAP, settings.workStartMin);
    const out: Block[] = [...existingCustoms];
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

  function save(next: Block[]) {
    setBlocks(next);
    fetch('/api/users/organise-plan', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ date: planDate, plan: { v: 1, blocks: next } }) }).catch(() => {});
  }

  // First-time generation once calendar + saved-plan lookup have settled and
  // there was no saved plan.
  useEffect(() => {
    if (didGenerate.current || !calLoaded || !planLoaded || blocks !== null) return;
    didGenerate.current = true;
    save(generate([], openMin));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [calLoaded, planLoaded, blocks]);

  const ready = blocks !== null;
  const rendered = (blocks ?? []).map(b => ({ block: b, item: b.kind === 'custom' ? null : queueById.get(b.key) ?? undefined }))
    .filter(r => r.block.kind === 'custom' || r.item !== undefined) as { block: Block; item: PlanItem | null }[];
  const scheduledKeys = new Set((blocks ?? []).map(b => b.key));
  const notScheduled = queue.filter(q => !scheduledKeys.has(q.id));

  const TIMELINE_H = ((dispEnd - dispStart) / 60) * PX_PER_HOUR;
  const PX_PER_MIN = PX_PER_HOUR / 60;
  const yFor = (m: number) => (m - dispStart) * PX_PER_MIN;
  const hFor = (m: number) => m * PX_PER_MIN;
  const clampStart = (start: number, dur: number) => Math.max(dispStart, Math.min(start, settings.workEndMin - dur));
  const clampDur = (dur: number, start: number) => Math.max(SNAP, Math.min(dur, dispEnd - start));

  const plannedMins = rendered.reduce((n, r) => n + r.block.dur, 0);
  const nowVisible = nowMin >= dispStart && nowMin <= dispEnd;

  // Live "on now / up next".
  const bannerItems = [
    ...rendered.map(r => ({ start: r.block.start, end: r.block.start + r.block.dur, title: r.item?.label ?? r.block.label ?? 'Focus time', open: r.item?.onOpen ?? null })),
    ...events.map(e => ({ start: e.start, end: e.end, title: e.title, open: null as (() => void) | null })),
    ...(lunch ? [{ start: lunch.start, end: lunch.start + lunch.dur, title: 'Lunch', open: null as (() => void) | null }] : []),
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
      const cur = blocks ?? [];
      save(cur.map(b => {
        if (b.key !== key) return b;
        return mode === 'move' ? { ...b, start: clampStart(baseStart + deltaMin, baseDur) } : { ...b, dur: clampDur(baseDur + deltaMin, baseStart) };
      }));
    };
    window.addEventListener('pointermove', onMove); window.addEventListener('pointerup', onUp);
  }

  function addBlockAt(offsetY: number) {
    const min = Math.round((dispStart + (offsetY / PX_PER_MIN)) / SNAP) * SNAP;
    customSeq.current += 1;
    save([...(blocks ?? []), { key: `focus-${Date.now()}-${customSeq.current}`, kind: 'custom', label: 'Focus time', start: clampStart(min, 30), dur: 30 }]);
  }
  function removeBlock(key: string) { save((blocks ?? []).filter(b => b.key !== key)); }
  function rePlan() { const customs = (blocks ?? []).filter(b => b.kind === 'custom'); save(generate(customs, nowMin)); }

  const previewFor = (key: string, start: number, dur: number) => {
    if (!drag || drag.key !== key) return { start, dur };
    return drag.mode === 'move' ? { start: clampStart(start + drag.deltaMin, dur), dur } : { start, dur: clampDur(dur + drag.deltaMin, start) };
  };

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
          <div className="relative flex-1 rounded-xl border border-gray-100 bg-gray-50/40" onClick={e => { if (e.target === e.currentTarget) addBlockAt(e.nativeEvent.offsetY); }}>
            {Array.from({ length: (dispEnd - dispStart) / 60 }, (_, i) => <div key={i} className="pointer-events-none absolute left-0 right-0 border-t border-dashed border-black/[0.05]" style={{ top: i * PX_PER_HOUR }} />)}

            {lunch && <div className="pointer-events-none absolute left-1.5 right-1.5 overflow-hidden rounded-lg border border-amber-200 bg-amber-50/70 px-2 py-1" style={{ top: Math.max(0, yFor(lunch.start)), height: Math.max(16, hFor(lunch.dur)) }}><p className="text-[11px] font-semibold text-amber-800">Lunch</p></div>}
            {wrap && <div className="pointer-events-none absolute left-1.5 right-1.5 overflow-hidden rounded-lg border border-slate-200 bg-slate-100/70 px-2 py-1" style={{ top: Math.max(0, yFor(wrap.start)), height: Math.max(16, hFor(wrap.dur)) }}><p className="text-[11px] font-semibold text-slate-600">Wrap up · plan tomorrow</p></div>}

            {events.map(ev => (
              <div key={ev.id} className="pointer-events-none absolute left-1.5 right-1.5 overflow-hidden rounded-lg border border-dashed border-indigo-300 bg-indigo-50/80 px-2 py-1" style={{ top: Math.max(0, yFor(ev.start)), height: Math.max(18, hFor(ev.minutes)) }}>
                <p className="truncate text-[11px] font-semibold text-indigo-900">{ev.title}</p>
                {hFor(ev.minutes) > 30 && <p className="truncate text-[10px] text-indigo-500">{ev.startHHmm} · {fmtDur(ev.minutes)}</p>}
              </div>
            ))}

            {rendered.map(({ block, item }) => {
              const p = previewFor(block.key, block.start, block.dur); const h = Math.max(22, hFor(p.dur));
              const isCustom = block.kind === 'custom';
              const color = isCustom ? '#64748b' : (item?.color ?? '#6366f1');
              const label = isCustom ? (block.label ?? 'Focus time') : (item?.label ?? '');
              const dragging = drag?.key === block.key;
              return (
                <div key={block.key} onPointerDown={e => beginDrag(e, block.key, 'move', block.start, block.dur, item?.onOpen)}
                  className={`group absolute left-1.5 right-1.5 overflow-hidden rounded-lg px-2.5 py-1.5 shadow-sm ${dragging ? 'z-20 cursor-grabbing ring-2' : 'cursor-grab'} ${isCustom ? 'border border-slate-300 bg-slate-100' : ''}`}
                  style={{ top: Math.max(0, yFor(p.start)), height: h, ...(isCustom ? {} : { background: `${color}1f`, borderLeft: `3px solid ${color}` }), touchAction: 'none', ...(dragging ? { boxShadow: `0 0 0 2px ${color}55` } : {}) }}>
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-1 truncate text-[12px] font-semibold text-gray-800">
                        {item?.kind === 'admin' && <CheckCircle2 size={12} style={{ color }} className="shrink-0" />}
                        {item?.kind === 'chase' && <AlertTriangle size={12} style={{ color }} className="shrink-0" />}
                        <span className="truncate">{label}{item?.kind === 'admin' && item.sub ? ` (${item.sub})` : ''}</span>
                      </p>
                      {h > 34 && <p className="truncate text-[10.5px] text-gray-500">{minToHHMM(p.start)}–{minToHHMM(p.start + p.dur)}{item && item.kind !== 'admin' && item.sub ? ` · ${item.sub}` : ''}</p>}
                    </div>
                    {item?.onDone && <button onPointerDown={e => e.stopPropagation()} onClick={item.onDone} aria-label="Mark done" className="shrink-0 rounded-md p-0.5 text-gray-300 opacity-0 transition-opacity hover:bg-emerald-50 hover:text-emerald-600 group-hover:opacity-100"><CheckCircle2 size={16} /></button>}
                    {isCustom && <button onPointerDown={e => e.stopPropagation()} onClick={() => removeBlock(block.key)} aria-label="Remove block" className="shrink-0 rounded-md p-0.5 text-slate-300 opacity-0 hover:bg-rose-50 hover:text-rose-500 group-hover:opacity-100"><X size={15} /></button>}
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
          <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-amber-700"><MoveRight size={12} /> Not in the plan ({notScheduled.length})</p>
          <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
            {notScheduled.map(it => (
              <div key={it.id} className="flex items-center gap-2 rounded-lg border border-gray-100 bg-white px-3 py-2 group">
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: it.color }} />
                <button onClick={it.onOpen} className="min-w-0 flex-1 text-left"><p className="truncate text-[12px] font-semibold text-gray-800">{it.label}</p>{it.sub && <p className="truncate text-[10.5px] text-gray-500">{it.sub}</p>}</button>
                {it.onDone && <button onClick={it.onDone} aria-label="Mark done" className="shrink-0 rounded-md p-1 text-gray-300 hover:bg-emerald-50 hover:text-emerald-600"><CheckCircle2 size={15} /></button>}
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
    </div>
  );
}
