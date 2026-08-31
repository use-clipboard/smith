'use client';

import { useMemo } from 'react';
import { CheckSquare, CalendarDays, CalendarRange, AlertCircle, CheckCircle2, Clock } from 'lucide-react';
import type { Task } from '@/types';

// Firm-wide task KPIs, computed from the loaded task set (the list route ships
// the whole firm graph). All figures are real — no placeholders.

type KpiFilter = 'open' | 'today' | 'this_week' | 'overdue';

interface Props {
  tasks: Task[];
  onSelect?: (f: KpiFilter) => void;
}

function startOfToday() { const d = new Date(); d.setHours(0, 0, 0, 0); return d; }

export default function TasksKpiStrip({ tasks, onSelect }: Props) {
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

  const sel = (f: KpiFilter) => (onSelect ? () => onSelect(f) : undefined);
  // tint = hex accent; drives the corner glow + icon chip (Timesheets KpiCard style).
  const cards: { label: string; val: string | number; tint: string; sub?: string; icon: React.ReactNode; click?: () => void }[] = [
    { label: 'Open Tasks', val: k.open, tint: '#6366F1', icon: <CheckSquare className="h-[18px] w-[18px]" />, click: sel('open') },
    { label: 'Due Today', val: k.dueToday, tint: '#F59E0B', icon: <CalendarDays className="h-[18px] w-[18px]" />, click: sel('today') },
    { label: 'This Week', val: k.thisWeek, tint: '#0EA5E9', icon: <CalendarRange className="h-[18px] w-[18px]" />, click: sel('this_week') },
    { label: 'Overdue', val: k.overdue, tint: '#F43F5E', icon: <AlertCircle className="h-[18px] w-[18px]" />, click: sel('overdue') },
    { label: 'Completion Rate', val: `${k.rate}%`, tint: '#10B981', icon: <CheckCircle2 className="h-[18px] w-[18px]" /> },
    { label: 'Avg Days to Complete', val: k.avg == null ? '—' : k.avg.toFixed(1), tint: '#8B5CF6', sub: 'days', icon: <Clock className="h-[18px] w-[18px]" /> },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3">
      {cards.map(c => {
        const Tag = c.click ? 'button' : 'div';
        return (
          <Tag
            key={c.label}
            {...(c.click ? { onClick: c.click, type: 'button' as const } : {})}
            className={`group relative overflow-hidden text-left rounded-[20px] bg-white border border-gray-100 shadow-[0_8px_32px_rgba(31,38,88,0.07)] p-4 transition-all duration-300 ${c.click ? 'cursor-pointer hover:-translate-y-0.5 hover:shadow-[0_14px_40px_rgba(31,38,88,0.14)]' : ''}`}
          >
            {/* corner glow */}
            <div className="pointer-events-none absolute -right-8 -top-8 h-24 w-24 rounded-full opacity-40 blur-2xl transition-opacity group-hover:opacity-70" style={{ background: c.tint }} />
            <div className="relative flex items-start justify-between">
              <div className="min-w-0">
                <p className="text-[11px] font-medium uppercase tracking-wide text-gray-500">{c.label}</p>
                <p className="mt-1.5 text-[26px] font-bold leading-none tabular-nums text-gray-900">{c.val}</p>
                {c.sub && <p className="mt-1.5 text-[11px] text-gray-400">{c.sub}</p>}
              </div>
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl" style={{ background: `${c.tint}1f`, color: c.tint }}>{c.icon}</span>
            </div>
          </Tag>
        );
      })}
    </div>
  );
}
