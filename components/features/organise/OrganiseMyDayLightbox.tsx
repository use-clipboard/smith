'use client';

import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Wand2, X, Minus, CheckCircle2, Loader2, Mail, HeartHandshake, CheckSquare } from 'lucide-react';
import { openTaskInTool } from '@/lib/notificationTarget';
import { buildDayPlan, dayPlanTaskCount } from '@/lib/tasks/dayPlan';
import { DEFAULT_ORGANISE_SETTINGS } from '@/lib/tasks/organiseSettings';
import { useEmailCount } from '@/components/ui/EmailCountProvider';
import { useNotifications } from '@/components/ui/NotificationsProvider';
import { useModules } from '@/components/ui/ModulesProvider';
import { useTabContext } from '@/components/ui/TabContext';
import OrganiseMyDayTimeline, { type AdminItem } from './OrganiseMyDayTimeline';
import type { Task } from '@/types';

// The large "Organise my day" lightbox. Fetches the user's tasks + the Briefing
// quick-wins (email / notifications / holidays / briefings) and hands them to the
// day-planner timeline, which auto-schedules them into the working day.

interface Props {
  minimised: boolean;
  onMinimise: () => void;
  onClose: () => void;
}

const C_EMAIL = '#4F46E5', C_NOTIF = '#ec4899', C_HOL = '#8b5cf6', C_BRIEF = '#0d9488';

export default function OrganiseMyDayLightbox({ minimised, onMinimise, onClose }: Props) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [userId, setUserId] = useState('');
  const [loading, setLoading] = useState(true);
  const [hr, setHr] = useState<{ pendingApprovals: number; newBriefings: number }>({ pendingApprovals: 0, newBriefings: 0 });

  const { isModuleActive } = useModules();
  const { openTab } = useTabContext();
  const { count: emailCount, mode: emailMode } = useEmailCount();
  const { unreadCount: notifications } = useNotifications();
  const hasEmail = isModuleActive('email-triage');
  const hasHr = isModuleActive('hr');

  useEffect(() => {
    let live = true;
    fetch('/api/tasks').then(r => (r.ok ? r.json() : { tasks: [] })).then((d: { tasks?: Task[] }) => { if (live) setTasks(d.tasks ?? []); }).catch(() => {}).finally(() => { if (live) setLoading(false); });
    fetch('/api/users/me').then(r => (r.ok ? r.json() : {})).then((d: { userId?: string }) => { if (live) setUserId(d.userId ?? ''); }).catch(() => {});
    if (hasHr) {
      fetch('/api/hr/badge-counts').then(r => (r.ok ? r.json() : null)).then((d: { pendingApprovals?: number; newBriefings?: number } | null) => {
        if (live && d) setHr({ pendingApprovals: d.pendingApprovals ?? 0, newBriefings: d.newBriefings ?? 0 });
      }).catch(() => {});
    }
    return () => { live = false; };
  }, [hasHr]);

  const plan = useMemo(() => buildDayPlan(tasks, userId), [tasks, userId]);
  const taskCount = dayPlanTaskCount(plan);

  // Quick-win admin blocks — scheduled before tasks. Each opens its tool rather
  // than being tick-completable. Only surfaced when there's something to do.
  const adminItems = useMemo<AdminItem[]>(() => {
    const openTool = (id: string, title: string, route: string, icon: typeof Mail) => () => { openTab({ id, title, route, icon }); onClose(); };
    const items: AdminItem[] = [];
    const emails = hasEmail ? (emailCount ?? 0) : 0;
    if (emails > 0) items.push({ key: 'email', label: emailMode === 'traditional' ? 'Read email' : 'Triage email', count: emails, minutes: Math.min(45, 15 + emails), color: C_EMAIL, onOpen: openTool('email-triage', 'Email', '/email', Mail) });
    if (notifications > 0) items.push({ key: 'notifs', label: 'Check notifications', count: notifications, minutes: 5, color: C_NOTIF, onOpen: () => { window.dispatchEvent(new CustomEvent('smith:open-notifications')); onClose(); } });
    if (hasHr && hr.pendingApprovals > 0) items.push({ key: 'holidays', label: 'Approve holidays', count: hr.pendingApprovals, minutes: Math.min(15, hr.pendingApprovals * 2), color: C_HOL, onOpen: openTool('hr', 'HR', '/hr', HeartHandshake) });
    if (hasHr && hr.newBriefings > 0) items.push({ key: 'briefings', label: 'Read briefings', count: hr.newBriefings, minutes: Math.min(20, hr.newBriefings * 5), color: C_BRIEF, onOpen: openTool('hr', 'HR', '/hr', HeartHandshake) });
    return items;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasEmail, emailCount, emailMode, notifications, hasHr, hr]);

  const hasPlan = taskCount > 0 || adminItems.length > 0;

  function markDone(id: string) {
    setTasks(prev => prev.map(t => (t.id === id ? { ...t, status: 'complete' as Task['status'] } : t)));
    fetch(`/api/tasks/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'complete' }) }).catch(() => {});
  }
  function openTask(t: Task) { openTaskInTool(t.id); onClose(); }
  function openTasksTool() { openTab({ id: 'tasks', title: 'Tasks', route: '/tasks', icon: CheckSquare }); onClose(); }

  if (typeof document === 'undefined') return null;
  // Minimised: stay mounted (state preserved) but render nothing — the header
  // sparkle-pencil button brings it back.
  if (minimised) return null;

  return createPortal(
    <div className="fixed inset-0 z-[95] flex items-start justify-center p-4 sm:p-8 bg-black/40 backdrop-blur-sm" onMouseDown={onClose}>
      <div onMouseDown={e => e.stopPropagation()} className="w-full max-w-4xl mt-4 sm:mt-8 max-h-[88vh] flex flex-col rounded-2xl bg-white shadow-2xl border border-black/5 overflow-hidden">
        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-4 text-white flex-shrink-0" style={{ background: 'linear-gradient(135deg,#4f46e5,#7c3aed)' }}>
          <span className="w-9 h-9 rounded-xl bg-white/15 grid place-items-center flex-shrink-0"><Wand2 className="h-5 w-5" /></span>
          <div className="min-w-0 flex-1">
            <p className="text-[15px] font-bold leading-tight">Organise my day</p>
            <p className="text-[12px] opacity-85 leading-tight">
              {loading ? 'Planning your day…' : !hasPlan ? "You're on top of it — nothing urgent" : 'Your plan for today, in priority order'}
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
                {[80, 95, 65, 90].map((w, i) => <div key={i} className="h-12 rounded-xl bg-gray-100" style={{ width: `${w}%` }} />)}
              </div>
            </div>
          ) : !hasPlan ? (
            <div className="text-center py-16">
              <CheckCircle2 className="h-10 w-10 text-emerald-500 mx-auto mb-3" />
              <p className="text-base font-semibold text-gray-800">You&rsquo;re on top of it</p>
              <p className="text-sm text-gray-500 mt-1">No email, admin or workable tasks to plan right now.</p>
            </div>
          ) : (
            <OrganiseMyDayTimeline
              tasks={tasks} userId={userId} adminItems={adminItems} settings={DEFAULT_ORGANISE_SETTINGS}
              onOpenTask={openTask} onMarkDone={markDone} onOpenTasks={openTasksTool}
            />
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
