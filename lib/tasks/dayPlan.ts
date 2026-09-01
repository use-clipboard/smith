import type { Task } from '@/types';

// Shared "Organise my day" bucketing — the user's own, not-complete tasks split
// into the order you should work them: overdue first, then records-in / ready-to-
// review, then due today / this week. Used by the dashboard lightbox and the
// Tasks-tool floating panel so they always agree.

export type DayBucketKey = 'overdue' | 'records' | 'review' | 'today' | 'soon';

export interface DayBucketMeta {
  key: DayBucketKey;
  label: string;
  hint: string;
  color: string;
  bg: string;
}

export const DAY_BUCKETS: DayBucketMeta[] = [
  { key: 'overdue', label: 'Overdue',         hint: 'clear these first', color: '#dc2626', bg: 'bg-red-50' },
  { key: 'records', label: 'Records in',      hint: 'ready to work',     color: '#7c3aed', bg: 'bg-violet-50' },
  { key: 'review',  label: 'Ready to review', hint: 'your sign-off',     color: '#0891b2', bg: 'bg-cyan-50' },
  { key: 'today',   label: 'Due today',       hint: '',                  color: '#d97706', bg: 'bg-amber-50' },
  { key: 'soon',    label: 'Due this week',   hint: '',                  color: '#4f46e5', bg: 'bg-indigo-50' },
];

export function buildDayPlan(tasks: Task[], userId: string): Record<DayBucketKey, Task[]> {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const weekEnd = new Date(today.getTime() + 7 * 86_400_000);
  const b: Record<DayBucketKey, Task[]> = { overdue: [], records: [], review: [], today: [], soon: [] };
  for (const t of tasks) {
    if (t.status === 'complete') continue;
    if (!t.steps?.some(s => s.assignee_id === userId)) continue;
    const due = t.due_date ? (() => { const d = new Date(t.due_date as string); d.setHours(0, 0, 0, 0); return d; })() : null;
    if (due && due < today) b.overdue.push(t);
    else if (t.status === 'records_here') b.records.push(t);
    else if (t.status === 'review') b.review.push(t);
    else if (due && due.getTime() === today.getTime()) b.today.push(t);
    else if (due && due <= weekEnd) b.soon.push(t);
  }
  const byDue = (a: Task, z: Task) => (a.due_date ? +new Date(a.due_date) : Infinity) - (z.due_date ? +new Date(z.due_date) : Infinity);
  (Object.keys(b) as DayBucketKey[]).forEach(k => b[k].sort(byDue));
  return b;
}

export function dayPlanTotal(plan: Record<DayBucketKey, Task[]>): number {
  return DAY_BUCKETS.reduce((n, x) => n + plan[x.key].length, 0);
}
