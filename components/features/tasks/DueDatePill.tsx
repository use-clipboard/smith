'use client';

import { CalendarClock } from 'lucide-react';
import Tooltip from '@/components/ui/Tooltip';
import type { TaskStatus } from '@/types';

/**
 * Reusable "Due {date}" pill for task lists.
 *
 * Colour-coded by proximity to the deadline, matching the colour scheme
 * already used by the All / Overdue / This week filter chips in
 * dueWindow.ts:
 *
 *   - Overdue          → red
 *   - Due today / ≤7 d → amber
 *   - Later            → neutral grey
 *   - Complete         → neutral grey ("Done" rather than "Due")
 *   - No date          → em-dash placeholder
 *
 * Built as a small inline-block element so it slots neatly into table
 * cells, panel rows and the client task list alike.
 */
interface Props {
  dueDate:   string | null | undefined; // ISO date string
  status?:   TaskStatus | null;
  /** Small (table cells) vs default (panel rows). */
  size?:     'sm' | 'md';
  className?: string;
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** classify how urgent a due-date is. exported so the same logic can be
 *  reused by anything outside the pill (sorting, grouping etc.). */
export function classifyDueProximity(
  dueDate: string | null | undefined,
  status: TaskStatus | null | undefined,
): 'complete' | 'no_date' | 'overdue' | 'soon' | 'later' {
  if (status === 'complete') return 'complete';
  if (!dueDate) return 'no_date';
  const today = startOfDay(new Date());
  const due   = startOfDay(new Date(dueDate));
  const diffDays = Math.round((due.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays < 0)      return 'overdue';
  if (diffDays <= 7)     return 'soon';
  return 'later';
}

export default function DueDatePill({ dueDate, status, size = 'md', className }: Props) {
  if (!dueDate) {
    return <span className={`text-xs text-[var(--text-muted)] ${className ?? ''}`}>—</span>;
  }

  const dateStr = new Date(dueDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  const proximity = classifyDueProximity(dueDate, status);

  // Colour scheme mirrors dueWindow.ts so the filter pills + the row pill
  // visually match (overdue=red, this week=amber, later=neutral).
  const styles: Record<typeof proximity, { cls: string; label: string; tip: string }> = {
    complete: { cls: 'text-emerald-700 bg-emerald-50 border-emerald-200',                  label: 'Done',     tip: 'Task complete' },
    overdue:  { cls: 'text-red-700     bg-red-50     border-red-200     font-semibold',    label: 'Overdue',  tip: 'Past the due date' },
    soon:     { cls: 'text-amber-800   bg-amber-50   border-amber-200   font-semibold',    label: 'Due',      tip: 'Due within 7 days' },
    later:    { cls: 'text-gray-700    bg-gray-50    border-gray-200    font-medium',      label: 'Due',      tip: 'Current due date' },
    no_date:  { cls: 'text-gray-500    bg-gray-50    border-gray-200',                     label: '—',        tip: 'No due date' },
  };
  const s = styles[proximity];

  const sizeCls = size === 'sm'
    ? 'px-1.5 py-0.5 text-[11px] gap-0.5'
    : 'px-2   py-0.5 text-xs   gap-1';

  return (
    <Tooltip label={s.tip} side="top" className="inline-flex flex-shrink-0">
      <span className={`inline-flex items-center rounded-md border tabular-nums ${sizeCls} ${s.cls} ${className ?? ''}`}>
        <CalendarClock className={size === 'sm' ? 'h-2.5 w-2.5' : 'h-3 w-3'} />
        <span className="opacity-70">{s.label}</span>
        <span>{dateStr}</span>
      </span>
    </Tooltip>
  );
}
