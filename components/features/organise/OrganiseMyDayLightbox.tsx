'use client';

import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Wand2, X, Minus, Maximize2, CheckCircle2, Loader2, ArrowRight } from 'lucide-react';
import { openTaskInTool } from '@/lib/notificationTarget';
import { buildDayPlan, dayPlanTotal, DAY_BUCKETS } from '@/lib/tasks/dayPlan';
import type { Task } from '@/types';

// The large "Organise my day" lightbox. Stage A: a spacious, opaque plan built
// from the user's tasks (bucketed by buildDayPlan), openable / minimisable from
// the header button + the dashboard Briefing tile. Stage B swaps the body for a
// time-blocked timeline (calendar blocks + auto-schedule).

interface Props {
  minimised: boolean;
  onMinimise: () => void;
  onClose: () => void;
}

function fmtDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : iso;
}

export default function OrganiseMyDayLightbox({ minimised, onMinimise, onClose }: Props) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [userId, setUserId] = useState('');
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    let live = true;
    fetch('/api/tasks').then(r => (r.ok ? r.json() : { tasks: [] })).then((d: { tasks?: Task[] }) => { if (live) setTasks(d.tasks ?? []); }).catch(() => {}).finally(() => { if (live) setLoading(false); });
    fetch('/api/users/me').then(r => (r.ok ? r.json() : {})).then((d: { userId?: string }) => { if (live) setUserId(d.userId ?? ''); }).catch(() => {});
    return () => { live = false; };
  }, []);

  const plan = useMemo(() => buildDayPlan(tasks, userId), [tasks, userId]);
  const total = dayPlanTotal(plan);
  const activeBuckets = DAY_BUCKETS.filter(b => plan[b.key].length > 0);

  function markDone(id: string) {
    setTasks(prev => prev.map(t => (t.id === id ? { ...t, status: 'complete' as Task['status'] } : t)));
    fetch(`/api/tasks/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'complete' }) }).catch(() => {});
  }

  function openTask(t: Task) { openTaskInTool(t.id); onClose(); }

  if (typeof document === 'undefined') return null;

  // ── Minimised: a floating chip bottom-right ──────────────────────────────────
  if (minimised) {
    return createPortal(
      <button
        onClick={onMinimise}
        className="fixed bottom-5 right-5 z-[95] inline-flex items-center gap-2.5 rounded-2xl px-4 py-3 text-white shadow-2xl hover:brightness-110 transition-all"
        style={{ background: 'linear-gradient(135deg,#4f46e5,#7c3aed)' }}
      >
        <Wand2 className="h-4 w-4" />
        <span className="text-[13px] font-bold">Organise my day</span>
        <span className="text-[11px] font-semibold bg-white/20 rounded-full px-2 py-0.5 tabular-nums">
          {loading ? '…' : total}
        </span>
        <Maximize2 className="h-3.5 w-3.5 opacity-80" />
      </button>,
      document.body,
    );
  }

  // ── Full lightbox ────────────────────────────────────────────────────────────
  return createPortal(
    <div className="fixed inset-0 z-[95] flex items-start justify-center p-4 sm:p-8 bg-black/40 backdrop-blur-sm" onMouseDown={onClose}>
      <div
        onMouseDown={e => e.stopPropagation()}
        className="w-full max-w-3xl mt-4 sm:mt-8 max-h-[88vh] flex flex-col rounded-2xl bg-white shadow-2xl border border-black/5 overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-4 text-white flex-shrink-0" style={{ background: 'linear-gradient(135deg,#4f46e5,#7c3aed)' }}>
          <span className="w-9 h-9 rounded-xl bg-white/15 grid place-items-center flex-shrink-0"><Wand2 className="h-5 w-5" /></span>
          <div className="min-w-0 flex-1">
            <p className="text-[15px] font-bold leading-tight">Organise my day</p>
            <p className="text-[12px] opacity-85 leading-tight">
              {loading ? 'Planning your day…' : total === 0 ? "You're on top of it — nothing urgent" : `${total} thing${total === 1 ? '' : 's'} to focus on, in priority order`}
            </p>
          </div>
          <button onClick={onMinimise} aria-label="Minimise" className="p-1.5 rounded-lg hover:bg-white/20"><Minus className="h-4 w-4" /></button>
          <button onClick={onClose} aria-label="Close" className="p-1.5 rounded-lg hover:bg-white/20"><X className="h-4 w-4" /></button>
        </div>

        {/* Body */}
        <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin p-5">
          {loading ? (
            <div className="py-10">
              <div className="flex items-center justify-center gap-2 text-indigo-600 mb-5">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span className="text-sm font-semibold">Planning your day…</span>
              </div>
              <div className="space-y-2.5 animate-pulse max-w-xl mx-auto">
                {[80, 95, 65, 90].map((w, i) => (
                  <div key={i} className="h-12 rounded-xl bg-gray-100" style={{ width: `${w}%` }} />
                ))}
              </div>
            </div>
          ) : total === 0 ? (
            <div className="text-center py-16">
              <CheckCircle2 className="h-10 w-10 text-emerald-500 mx-auto mb-3" />
              <p className="text-base font-semibold text-gray-800">You&rsquo;re on top of it</p>
              <p className="text-sm text-gray-500 mt-1">No overdue, records-in, review or due-soon tasks assigned to you.</p>
            </div>
          ) : (
            <div className="space-y-5">
              {activeBuckets.map(bkt => {
                const items = plan[bkt.key];
                const showAll = expanded.has(bkt.key);
                const shown = showAll ? items : items.slice(0, 8);
                return (
                  <div key={bkt.key}>
                    <div className="flex items-center gap-2 mb-2">
                      <span className="w-2.5 h-2.5 rounded-full" style={{ background: bkt.color }} />
                      <span className="text-[12px] font-bold uppercase tracking-wide text-gray-700">{bkt.label}</span>
                      {bkt.hint && <span className="text-[11px] text-gray-400">· {bkt.hint}</span>}
                      <span className="ml-auto text-[11px] font-bold text-gray-400 tabular-nums">{items.length}</span>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {shown.map(t => (
                        <div key={t.id} className={`flex items-center gap-2.5 rounded-xl border border-gray-100 ${bkt.bg} px-3.5 py-2.5 hover:border-indigo-200 transition-colors group`}>
                          <button onClick={() => openTask(t)} className="min-w-0 flex-1 text-left">
                            <p className="text-[13px] font-semibold text-gray-800 truncate">{t.title}</p>
                            <p className="text-[11.5px] text-gray-500 truncate">
                              {t.is_internal ? 'Internal' : (t.client?.name ?? '—')}
                              {t.due_date && <> · due {fmtDate(t.due_date)}</>}
                            </p>
                          </button>
                          <button onClick={() => markDone(t.id)} aria-label="Mark done"
                            className="flex-shrink-0 w-8 h-8 rounded-lg grid place-items-center text-gray-300 hover:text-emerald-600 hover:bg-emerald-50 transition-colors">
                            <CheckCircle2 className="h-[19px] w-[19px]" />
                          </button>
                        </div>
                      ))}
                    </div>
                    {items.length > 8 && (
                      <button
                        onClick={() => setExpanded(s => { const n = new Set(s); if (n.has(bkt.key)) n.delete(bkt.key); else n.add(bkt.key); return n; })}
                        className="mt-1.5 text-[12px] font-semibold text-indigo-600 hover:underline inline-flex items-center gap-1"
                      >
                        {showAll ? 'Show less' : `+ ${items.length - 8} more`} <ArrowRight className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
