'use client';

import { useMemo } from 'react';
import { CheckSquare, CalendarDays, CalendarRange, AlertCircle, CheckCircle2, Clock } from 'lucide-react';
import type { Task } from '@/types';

// Firm-wide task KPIs, computed from the loaded task set (the list route ships
// the whole firm graph). All figures are real — no placeholders.

interface Props {
  tasks: Task[];
  onOpenAll?: () => void;
}

function startOfToday() { const d = new Date(); d.setHours(0, 0, 0, 0); return d; }

export default function TasksKpiStrip({ tasks, onOpenAll }: Props) {
  const k = useMemo(() => {
    const today = startOfToday();
    const day = today.getDay();
    const diffToMonday = day === 0 ? -6 : 1 - day;
    const weekStart = new Date(today); weekStart.setDate(today.getDate() + diffToMonday);
    const weekEnd = new Date(weekStart); weekEnd.setDate(weekStart.getDate() + 6); weekEnd.setHours(23, 59, 59, 999);

    let open = 0, dueToday = 0, thisWeek = 0, overdue = 0, complete = 0, avgSum = 0, avgN = 0;
    for (const t of tasks) {
      if (t.status === 'complete') {
        complete++;
        if (t.completed_at && t.created_at) {
          const days = (new Date(t.completed_at).getTime() - new Date(t.created_at).getTime()) / 86_400_000;
          if (days >= 0 && days < 3650) { avgSum += days; avgN++; }
        }
        continue;
      }
      if ((t.status as string) === 'draft') continue;
      open++;
      if (!t.due_date) continue;
      const d = new Date(t.due_date); d.setHours(0, 0, 0, 0);
      if (d < today) overdue++;
      else if (d.getTime() === today.getTime()) dueToday++;
      if (d >= weekStart && d <= weekEnd) thisWeek++;
    }
    const total = open + complete;
    const rate = total > 0 ? Math.round((complete / total) * 100) : 0;
    const avg = avgN > 0 ? (avgSum / avgN) : null;
    return { open, dueToday, thisWeek, overdue, rate, avg };
  }, [tasks]);

  const cards: { label: string; val: string | number; tone: string; icon: React.ReactNode; click?: () => void }[] = [
    { label: 'Open Tasks', val: k.open, tone: 'indigo', icon: <CheckSquare className="h-4 w-4" />, click: onOpenAll },
    { label: 'Due Today', val: k.dueToday, tone: 'amber', icon: <CalendarDays className="h-4 w-4" /> },
    { label: 'This Week', val: k.thisWeek, tone: 'blue', icon: <CalendarRange className="h-4 w-4" /> },
    { label: 'Overdue', val: k.overdue, tone: 'red', icon: <AlertCircle className="h-4 w-4" /> },
    { label: 'Completion Rate', val: `${k.rate}%`, tone: 'green', icon: <CheckCircle2 className="h-4 w-4" /> },
    { label: 'Avg Days to Complete', val: k.avg == null ? '—' : k.avg.toFixed(1), tone: 'indigo', icon: <Clock className="h-4 w-4" /> },
  ];

  const TONES: Record<string, string> = {
    indigo: 'bg-indigo-50 text-indigo-600',
    amber: 'bg-amber-50 text-amber-600',
    blue: 'bg-sky-50 text-sky-600',
    red: 'bg-red-50 text-red-600',
    green: 'bg-emerald-50 text-emerald-600',
  };

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3">
      {cards.map(c => {
        const Tag = c.click ? 'button' : 'div';
        return (
          <Tag
            key={c.label}
            {...(c.click ? { onClick: c.click, type: 'button' as const } : {})}
            className={`text-left bg-white border border-gray-200 rounded-2xl px-4 py-3.5 shadow-sm transition-all ${c.click ? 'hover:border-indigo-300 hover:-translate-y-0.5 cursor-pointer' : ''}`}
          >
            <div className="flex items-center justify-between">
              <span className="text-[11.5px] font-semibold text-gray-500">{c.label}</span>
              <span className={`w-7 h-7 rounded-lg grid place-items-center ${TONES[c.tone]}`}>{c.icon}</span>
            </div>
            <div className="text-2xl font-extrabold tracking-tight mt-2 tabular-nums text-gray-900">{c.val}</div>
          </Tag>
        );
      })}
    </div>
  );
}
