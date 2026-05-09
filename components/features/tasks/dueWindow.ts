import type { Task } from '@/types';

export type DueWindow = 'all' | 'overdue' | 'today' | 'this_week' | 'later' | 'no_due';

export const DUE_WINDOW_CONFIG: Record<Exclude<DueWindow, 'all'>, { label: string; activeCls: string; idleCls: string }> = {
  overdue:   { label: 'Overdue',     activeCls: 'bg-red-600 text-white',    idleCls: 'bg-red-50 text-red-700 hover:bg-red-100 border-red-200' },
  today:     { label: 'Due today',   activeCls: 'bg-amber-500 text-white',  idleCls: 'bg-amber-50 text-amber-700 hover:bg-amber-100 border-amber-200' },
  this_week: { label: 'This week',   activeCls: 'bg-indigo-600 text-white', idleCls: 'bg-indigo-50 text-indigo-700 hover:bg-indigo-100 border-indigo-200' },
  later:     { label: 'Later',       activeCls: 'bg-gray-600 text-white',   idleCls: 'bg-gray-50 text-gray-700 hover:bg-gray-100 border-gray-200' },
  no_due:    { label: 'No due date', activeCls: 'bg-gray-500 text-white',   idleCls: 'bg-gray-50 text-gray-600 hover:bg-gray-100 border-gray-200' },
};

export function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** Classifies an active (non-complete) task into a due-window bucket. Returns null for completed tasks. */
export function classifyDue(task: Task, today: Date, weekEnd: Date): DueWindow | null {
  if (task.status === 'complete') return null;
  if (!task.due_date) return 'no_due';
  const due = startOfDay(new Date(task.due_date));
  if (due.getTime() < today.getTime()) return 'overdue';
  if (due.getTime() === today.getTime()) return 'today';
  if (due.getTime() < weekEnd.getTime()) return 'this_week';
  return 'later';
}

export function classifyTasks(tasks: Task[]): {
  classMap: Map<string, DueWindow | null>;
  counts: Record<Exclude<DueWindow, 'all'>, number>;
} {
  const today = startOfDay(new Date());
  const weekEnd = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000);
  const classMap = new Map<string, DueWindow | null>();
  const counts: Record<Exclude<DueWindow, 'all'>, number> = { overdue: 0, today: 0, this_week: 0, later: 0, no_due: 0 };
  for (const t of tasks) {
    const w = classifyDue(t, today, weekEnd);
    classMap.set(t.id, w);
    if (w) counts[w] += 1;
  }
  return { classMap, counts };
}

export function applyDueFilter(tasks: Task[], classMap: Map<string, DueWindow | null>, dueFilter: DueWindow): Task[] {
  if (dueFilter === 'all') return tasks;
  return tasks.filter(t => classMap.get(t.id) === dueFilter);
}
