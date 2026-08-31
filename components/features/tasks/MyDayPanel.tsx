'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Sparkles, X, Minus, Maximize2, GripVertical, ArrowRight, CheckCircle2 } from 'lucide-react';
import type { Task } from '@/types';

// "Organise my day" — a floating, draggable, minimisable plan of what to focus
// on today: my overdue work, tasks with records in / ready for my review, and
// what's due today / this week. Each item opens in the detail panel.

interface Props {
  tasks: Task[];
  currentUserId: string;
  onOpenTask: (t: Task) => void;
  onMarkDone: (taskId: string) => void;
  onClose: () => void;
  /** Non-task briefing items (dashboard use) — emails, notifications, holidays… */
  extras?: { key: string; label: string; count: number; color: string; onClick: () => void }[];
}

type BucketKey = 'overdue' | 'records' | 'review' | 'today' | 'soon';

const BUCKETS: { key: BucketKey; label: string; hint: string; color: string; bg: string }[] = [
  { key: 'overdue', label: 'Overdue',         hint: 'clear these first',   color: '#dc2626', bg: 'bg-red-50' },
  { key: 'records', label: 'Records in',      hint: 'ready to work',       color: '#7c3aed', bg: 'bg-violet-50' },
  { key: 'review',  label: 'Ready to review', hint: 'your sign-off',       color: '#0891b2', bg: 'bg-cyan-50' },
  { key: 'today',   label: 'Due today',       hint: '',                    color: '#d97706', bg: 'bg-amber-50' },
  { key: 'soon',    label: 'Due this week',   hint: '',                    color: '#4f46e5', bg: 'bg-indigo-50' },
];

function startOfToday() { const d = new Date(); d.setHours(0, 0, 0, 0); return d; }

export default function MyDayPanel({ tasks, currentUserId, onOpenTask, onMarkDone, onClose, extras = [] }: Props) {
  const [min, setMin] = useState(false);
  const [pos, setPos] = useState<{ x: number; y: number }>({ x: -1, y: -1 });
  const drag = useRef<{ dx: number; dy: number } | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Default position: bottom-right, once we know the panel size.
  useEffect(() => {
    if (pos.x < 0 && typeof window !== 'undefined') {
      setPos({ x: window.innerWidth - 380, y: Math.max(90, window.innerHeight - 560) });
    }
  }, [pos.x]);

  useEffect(() => {
    function move(e: MouseEvent) {
      if (!drag.current) return;
      const w = panelRef.current?.offsetWidth ?? 340;
      const x = Math.min(Math.max(8, e.clientX - drag.current.dx), window.innerWidth - w - 8);
      const y = Math.min(Math.max(8, e.clientY - drag.current.dy), window.innerHeight - 60);
      setPos({ x, y });
    }
    function up() { drag.current = null; document.body.style.userSelect = ''; }
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    return () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
  }, []);

  function onHeaderDown(e: React.MouseEvent) {
    const r = panelRef.current?.getBoundingClientRect();
    if (!r) return;
    drag.current = { dx: e.clientX - r.left, dy: e.clientY - r.top };
    document.body.style.userSelect = 'none';
  }

  const plan = useMemo(() => {
    const today = startOfToday();
    const weekEnd = new Date(today.getTime() + 7 * 86_400_000);
    const b: Record<BucketKey, Task[]> = { overdue: [], records: [], review: [], today: [], soon: [] };
    for (const t of tasks) {
      if (t.status === 'complete') continue;
      if (!t.steps?.some(s => s.assignee_id === currentUserId)) continue;
      const due = t.due_date ? (() => { const d = new Date(t.due_date as string); d.setHours(0, 0, 0, 0); return d; })() : null;
      if (due && due < today) b.overdue.push(t);
      else if (t.status === 'records_here') b.records.push(t);
      else if (t.status === 'review') b.review.push(t);
      else if (due && due.getTime() === today.getTime()) b.today.push(t);
      else if (due && due <= weekEnd) b.soon.push(t);
    }
    const byDue = (a: Task, z: Task) => (a.due_date ? +new Date(a.due_date) : Infinity) - (z.due_date ? +new Date(z.due_date) : Infinity);
    (Object.keys(b) as BucketKey[]).forEach(k => b[k].sort(byDue));
    return b;
  }, [tasks, currentUserId]);

  const taskTotal = BUCKETS.reduce((n, x) => n + plan[x.key].length, 0);
  const extrasTotal = extras.reduce((n, e) => n + e.count, 0);
  const total = taskTotal + extrasTotal;
  const activeBuckets = BUCKETS.filter(x => plan[x.key].length > 0);
  const activeExtras = extras.filter(e => e.count > 0);

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div
      ref={panelRef}
      style={{ position: 'fixed', left: pos.x < 0 ? undefined : pos.x, top: pos.y < 0 ? undefined : pos.y, right: pos.x < 0 ? 24 : undefined, bottom: pos.y < 0 ? 24 : undefined, width: 356 }}
      className="z-[80] rounded-2xl border border-gray-200 bg-white shadow-2xl overflow-hidden"
    >
      {/* Header (drag handle) */}
      <div onMouseDown={onHeaderDown} className="flex items-center gap-2 px-3.5 py-3 cursor-grab active:cursor-grabbing text-white" style={{ background: 'linear-gradient(135deg,#4f46e5,#7c3aed)' }}>
        <GripVertical className="h-4 w-4 opacity-70 flex-shrink-0" />
        <Sparkles className="h-4 w-4 flex-shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-bold leading-tight">My Day</p>
          <p className="text-[11px] opacity-80 leading-tight">{total === 0 ? 'Nothing urgent — nice' : `${total} thing${total === 1 ? '' : 's'} to focus on`}</p>
        </div>
        <button onClick={() => setMin(m => !m)} aria-label={min ? 'Expand' : 'Minimise'} className="p-1 rounded-lg hover:bg-white/20">
          {min ? <Maximize2 className="h-3.5 w-3.5" /> : <Minus className="h-3.5 w-3.5" />}
        </button>
        <button onClick={onClose} aria-label="Close" className="p-1 rounded-lg hover:bg-white/20"><X className="h-3.5 w-3.5" /></button>
      </div>

      {!min && (
        <div className="max-h-[52vh] overflow-y-auto scrollbar-thin p-3 space-y-3">
          {total === 0 ? (
            <div className="text-center py-8">
              <CheckCircle2 className="h-8 w-8 text-emerald-500 mx-auto mb-2" />
              <p className="text-sm font-semibold text-gray-800">You&rsquo;re on top of it</p>
              <p className="text-xs text-gray-500 mt-1">No overdue, records-in, review or due-soon tasks assigned to you.</p>
            </div>
          ) : (
            <>
              {activeBuckets.map(bkt => (
                <div key={bkt.key}>
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className="w-2 h-2 rounded-full" style={{ background: bkt.color }} />
                    <span className="text-[11px] font-bold uppercase tracking-wide text-gray-600">{bkt.label}</span>
                    {bkt.hint && <span className="text-[10px] text-gray-400">· {bkt.hint}</span>}
                    <span className="ml-auto text-[10px] font-bold text-gray-400 tabular-nums">{plan[bkt.key].length}</span>
                  </div>
                  <div className="space-y-1.5">
                    {plan[bkt.key].slice(0, 6).map(t => (
                      <div key={t.id} className={`flex items-center gap-2 rounded-xl border border-gray-100 ${bkt.bg} px-3 py-2 hover:border-indigo-200 transition-colors group`}>
                        <button onClick={() => onOpenTask(t)} className="min-w-0 flex-1 text-left">
                          <p className="text-[12.5px] font-semibold text-gray-800 truncate">{t.title}</p>
                          <p className="text-[11px] text-gray-500 truncate">
                            {t.is_internal ? 'Internal' : (t.client?.name ?? '—')}
                            {t.due_date && <> · due {fmtDate(t.due_date)}</>}
                          </p>
                        </button>
                        <button onClick={() => onMarkDone(t.id)} aria-label="Mark done"
                          className="flex-shrink-0 w-7 h-7 rounded-lg grid place-items-center text-gray-300 hover:text-emerald-600 hover:bg-emerald-50 transition-colors">
                          <CheckCircle2 className="h-[18px] w-[18px]" />
                        </button>
                      </div>
                    ))}
                    {plan[bkt.key].length > 6 && <p className="text-[11px] text-gray-400 pl-1">+ {plan[bkt.key].length - 6} more</p>}
                  </div>
                </div>
              ))}

              {activeExtras.length > 0 && (
                <div>
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className="text-[11px] font-bold uppercase tracking-wide text-gray-600">Also on your plate</span>
                  </div>
                  <div className="space-y-1.5">
                    {activeExtras.map(e => (
                      <button key={e.key} onClick={e.onClick}
                        className="w-full flex items-center gap-2.5 rounded-xl border border-gray-100 bg-gray-50 px-3 py-2 hover:border-indigo-200 transition-colors group">
                        <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: e.color }} />
                        <span className="text-[12.5px] font-medium text-gray-800 flex-1 text-left">{e.label}</span>
                        <span className="text-[11px] font-bold text-gray-500 tabular-nums bg-white border border-gray-200 rounded-full px-2 py-0.5">{e.count}</span>
                        <ArrowRight className="h-3.5 w-3.5 text-gray-300 group-hover:text-indigo-500 flex-shrink-0" />
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>,
    document.body,
  );
}

function fmtDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : iso;
}
