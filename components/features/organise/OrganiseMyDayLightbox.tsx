'use client';

import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Wand2, X, Minus, CheckCircle2, Loader2 } from 'lucide-react';
import { openTaskInTool } from '@/lib/notificationTarget';
import { buildDayPlan, dayPlanTotal } from '@/lib/tasks/dayPlan';
import OrganiseMyDayTimeline from './OrganiseMyDayTimeline';
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

export default function OrganiseMyDayLightbox({ minimised, onMinimise, onClose }: Props) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [userId, setUserId] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let live = true;
    fetch('/api/tasks').then(r => (r.ok ? r.json() : { tasks: [] })).then((d: { tasks?: Task[] }) => { if (live) setTasks(d.tasks ?? []); }).catch(() => {}).finally(() => { if (live) setLoading(false); });
    fetch('/api/users/me').then(r => (r.ok ? r.json() : {})).then((d: { userId?: string }) => { if (live) setUserId(d.userId ?? ''); }).catch(() => {});
    return () => { live = false; };
  }, []);

  const plan = useMemo(() => buildDayPlan(tasks, userId), [tasks, userId]);
  const total = dayPlanTotal(plan);

  function markDone(id: string) {
    setTasks(prev => prev.map(t => (t.id === id ? { ...t, status: 'complete' as Task['status'] } : t)));
    fetch(`/api/tasks/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'complete' }) }).catch(() => {});
  }

  function openTask(t: Task) { openTaskInTool(t.id); onClose(); }

  if (typeof document === 'undefined') return null;

  // Minimised: stay mounted (state preserved) but render nothing — the header
  // sparkle-pencil button brings it back. No floating chip.
  if (minimised) return null;

  // ── Full lightbox ────────────────────────────────────────────────────────────
  return createPortal(
    <div className="fixed inset-0 z-[95] flex items-start justify-center p-4 sm:p-8 bg-black/40 backdrop-blur-sm" onMouseDown={onClose}>
      <div
        onMouseDown={e => e.stopPropagation()}
        className="w-full max-w-4xl mt-4 sm:mt-8 max-h-[88vh] flex flex-col rounded-2xl bg-white shadow-2xl border border-black/5 overflow-hidden"
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
            <OrganiseMyDayTimeline tasks={tasks} userId={userId} onOpenTask={openTask} onMarkDone={markDone} />
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
