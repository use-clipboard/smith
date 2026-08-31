'use client';

import { useMemo } from 'react';
import { Users, Repeat, LayoutTemplate, Clock3, Sparkles } from 'lucide-react';
import type { Task } from '@/types';

// Right insight rail — My Tasks donut, a spotlight on the most urgent task, a
// real breakdown, and the templates CTA. Auto-collapses below the parent's
// breakpoint (the parent hides it and shows a floating toggle).

interface Props {
  tasks: Task[];
  currentUserId: string;
  onViewMine: () => void;
  onExploreTemplates: () => void;
  onOpenTask: (t: Task) => void;
}

function startOfToday() { const d = new Date(); d.setHours(0, 0, 0, 0); return d; }

export default function TasksRightRail({ tasks, currentUserId, onViewMine, onExploreTemplates, onOpenTask }: Props) {
  const data = useMemo(() => {
    const today = startOfToday();
    const day = today.getDay();
    const weekStart = new Date(today); weekStart.setDate(today.getDate() + (day === 0 ? -6 : 1 - day));
    const weekEnd = new Date(weekStart); weekEnd.setDate(weekStart.getDate() + 6); weekEnd.setHours(23, 59, 59, 999);

    const mine = tasks.filter(t => t.status !== 'complete' && (t.status as string) !== 'draft'
      && t.steps?.some(s => s.assignee_id === currentUserId));

    let overdue = 0, dueToday = 0, week = 0, later = 0;
    let spotlight: Task | null = null; let spotScore = -Infinity;
    for (const t of mine) {
      if (t.due_date) {
        const d = new Date(t.due_date); d.setHours(0, 0, 0, 0);
        if (d < today) overdue++;
        else if (d.getTime() === today.getTime()) dueToday++;
        else if (d <= weekEnd) week++;
        else later++;
        // Most urgent = most overdue, else soonest due.
        const score = (today.getTime() - d.getTime());
        if (score > spotScore) { spotScore = score; spotlight = t; }
      } else later++;
    }

    const clientLinked = tasks.filter(t => !t.is_internal && t.client_id).length;
    const recurring = tasks.filter(t => t.recurrence_type && t.recurrence_type !== 'once').length;
    const fromTemplate = tasks.filter(t => t.template_id).length;
    const waiting = tasks.filter(t => t.status === 'waiting_on_client').length;

    return { total: mine.length, overdue, dueToday, week, later, spotlight, clientLinked, recurring, fromTemplate, waiting };
  }, [tasks, currentUserId]);

  // Donut segments (order: overdue, today, week, later).
  const segs = [
    { c: '#dc2626', n: data.overdue },
    { c: '#d97706', n: data.dueToday },
    { c: '#6366f1', n: data.week },
    { c: '#94a3b8', n: data.later },
  ];
  const sum = segs.reduce((a, s) => a + s.n, 0) || 1;
  let acc = 0;
  const stops = segs.map(s => { const from = (acc / sum) * 100; acc += s.n; const to = (acc / sum) * 100; return `${s.c} ${from}% ${to}%`; }).join(', ');
  const donutBg = data.total === 0 ? '#e5e7eb' : `conic-gradient(${stops})`;

  const sp = data.spotlight;
  const spDue = sp?.due_date ? relDue(sp.due_date) : null;

  return (
    <div className="w-[300px] flex-shrink-0 flex flex-col gap-3.5 overflow-y-auto pr-1">
      {/* My Tasks donut */}
      <div className="bg-white border border-gray-200 rounded-2xl p-4 shadow-sm">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-[13px] font-bold text-gray-900">My Tasks</h3>
          <button onClick={onViewMine} className="text-[11.5px] font-semibold text-indigo-600 hover:underline">View all →</button>
        </div>
        <div className="flex items-center gap-4">
          <div className="relative w-[92px] h-[92px] flex-shrink-0 rounded-full grid place-items-center" style={{ background: donutBg }}>
            <div className="absolute inset-[13px] rounded-full bg-white" />
            <div className="relative text-center">
              <div className="text-[21px] font-extrabold leading-none tabular-nums text-gray-900">{data.total}</div>
              <div className="text-[9.5px] font-semibold text-gray-400">Tasks</div>
            </div>
          </div>
          <div className="flex-1 flex flex-col gap-1.5">
            <Legend c="#dc2626" label="Overdue" n={data.overdue} />
            <Legend c="#d97706" label="Due today" n={data.dueToday} />
            <Legend c="#6366f1" label="This week" n={data.week} />
            <Legend c="#94a3b8" label="Later" n={data.later} />
          </div>
        </div>
      </div>

      {/* Spotlight */}
      {sp && (
        <div className="bg-white border border-gray-200 rounded-2xl p-4 shadow-sm">
          <h3 className="text-[13px] font-bold text-gray-900 mb-3 flex items-center gap-1.5"><Sparkles className="h-3.5 w-3.5 text-indigo-500" /> Task Spotlight</h3>
          <div className="rounded-xl border border-indigo-100 bg-gradient-to-b from-indigo-50 to-transparent p-3">
            <div className="font-semibold text-[13px] text-gray-900 truncate">{sp.title}</div>
            <div className="text-[11.5px] text-gray-500 mt-0.5 truncate">
              {sp.is_internal ? 'Internal' : (sp.client?.name ?? 'Unassigned client')}
              {spDue && <> · <span className={spDue.overdue ? 'text-red-600 font-medium' : ''}>{spDue.label}</span></>}
            </div>
            <button onClick={() => onOpenTask(sp)} className="mt-3 w-full text-[12px] font-semibold py-1.5 rounded-lg border border-gray-200 bg-white hover:border-indigo-300 hover:text-indigo-700 transition-colors">
              View task
            </button>
          </div>
        </div>
      )}

      {/* Breakdown */}
      <div className="bg-white border border-gray-200 rounded-2xl p-4 shadow-sm">
        <h3 className="text-[13px] font-bold text-gray-900 mb-2">Across the firm</h3>
        <div className="flex flex-col">
          <Stat icon={<Users className="h-[15px] w-[15px]" />} tone="bg-indigo-50 text-indigo-600" label="Client-linked tasks" n={data.clientLinked} />
          <Stat icon={<Repeat className="h-[15px] w-[15px]" />} tone="bg-sky-50 text-sky-600" label="Recurring series" n={data.recurring} />
          <Stat icon={<LayoutTemplate className="h-[15px] w-[15px]" />} tone="bg-emerald-50 text-emerald-600" label="From a template" n={data.fromTemplate} />
          <Stat icon={<Clock3 className="h-[15px] w-[15px]" />} tone="bg-amber-50 text-amber-600" label="Waiting on client" n={data.waiting} />
        </div>
      </div>

      {/* Automate */}
      <div className="rounded-2xl p-4 text-white shadow-sm" style={{ background: 'linear-gradient(135deg,#4f46e5,#7c3aed)' }}>
        <h3 className="text-[13px] font-bold mb-1">Automate Your Workflow</h3>
        <p className="text-[12px] opacity-90 mb-3">Save time with task templates and recurring tasks.</p>
        <button onClick={onExploreTemplates} className="w-full flex items-center justify-center gap-2 text-[12.5px] font-semibold py-2 rounded-lg bg-white/15 border border-white/25 hover:bg-white/25 transition-colors">
          <LayoutTemplate className="h-4 w-4" /> Explore templates
        </button>
      </div>
    </div>
  );
}

function Legend({ c, label, n }: { c: string; label: string; n: number }) {
  return (
    <div className="flex items-center gap-2 text-[12px]">
      <span className="w-2.5 h-2.5 rounded-[3px]" style={{ background: c }} />
      <span className="text-gray-600">{label}</span>
      <span className="ml-auto font-bold tabular-nums text-gray-900">{n}</span>
    </div>
  );
}

function Stat({ icon, tone, label, n }: { icon: React.ReactNode; tone: string; label: string; n: number }) {
  return (
    <div className="flex items-center gap-2.5 py-1.5">
      <span className={`w-7 h-7 rounded-lg grid place-items-center ${tone}`}>{icon}</span>
      <span className="text-[12.5px] text-gray-700">{label}</span>
      <span className="ml-auto font-bold text-[13px] tabular-nums text-gray-900">{n}</span>
    </div>
  );
}

function relDue(iso: string): { label: string; overdue: boolean } {
  const today = startOfToday();
  const d = new Date(iso); d.setHours(0, 0, 0, 0);
  const days = Math.round((d.getTime() - today.getTime()) / 86_400_000);
  if (days < 0) return { label: `${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'} overdue`, overdue: true };
  if (days === 0) return { label: 'due today', overdue: true };
  if (days === 1) return { label: 'due tomorrow', overdue: false };
  return { label: `due in ${days} days`, overdue: false };
}
