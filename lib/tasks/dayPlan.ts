import type { Task } from '@/types';

// Shared "Organise my day" task prioritisation. Splits the user's own, workable
// tasks into scheduling tiers (in priority order) plus a "chase" pile for stuck
// overdue work. Used by the day-planner timeline + the launcher's ready check.
//
// Priority order the day is built in (admin items are scheduled before all of
// these by the timeline): Due today → Records in → Ready to review → Due this
// week → (grouped) Investigate/chase overdue.

export type PlanTier = 'today' | 'records' | 'review' | 'week';

export const TIER_META: { tier: PlanTier; label: string; hint: string; color: string }[] = [
  { tier: 'today',   label: 'Due today',       hint: 'deadline today',   color: '#d97706' },
  { tier: 'records', label: 'Records in',      hint: 'ready to work',     color: '#7c3aed' },
  { tier: 'review',  label: 'Ready to review', hint: 'your sign-off',     color: '#0891b2' },
  { tier: 'week',    label: 'Due this week',   hint: 'coming up',         color: '#4f46e5' },
];
export const CHASE_COLOR = '#dc2626';

/** Inactive / on-hold clients are dropped entirely from the plan (their work
 *  shouldn't be scheduled). Internal tasks (no client) are never blocked. */
function clientBlocked(t: Task): boolean {
  const s = (t.client as { status?: string | null } | null | undefined)?.status ?? null;
  return s === 'inactive' || s === 'hold';
}

export interface DayPlanResult {
  tierTasks: Record<PlanTier, Task[]>;
  /** Stuck overdue (not actionable) — grouped into one chase block. */
  chase: Task[];
  /** Waiting on the client — can't be actioned, surfaced as a footnote only. */
  waiting: Task[];
}

export function buildDayPlan(tasks: Task[], userId: string): DayPlanResult {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const weekEnd = new Date(today.getTime() + 7 * 86_400_000);
  const tierTasks: Record<PlanTier, Task[]> = { today: [], records: [], review: [], week: [] };
  const chase: Task[] = [];
  const waiting: Task[] = [];

  for (const t of tasks) {
    if (t.status === 'complete' || t.status === 'draft') continue;   // done / not activated
    if (!t.steps?.some(s => s.assignee_id === userId)) continue;      // not my work
    if (clientBlocked(t)) continue;                                  // inactive / on-hold client
    if (t.status === 'waiting_on_client') { waiting.push(t); continue; } // can't action

    const due = t.due_date ? (() => { const d = new Date(t.due_date as string); d.setHours(0, 0, 0, 0); return d; })() : null;
    const overdue = !!due && due < today;
    const isToday = !!due && due.getTime() === today.getTime();

    if (isToday) tierTasks.today.push(t);
    else if (t.status === 'records_here') tierTasks.records.push(t);  // actionable (incl. overdue-with-records → smart)
    else if (t.status === 'review') tierTasks.review.push(t);        // actionable (incl. overdue in review)
    else if (due && due <= weekEnd && !overdue) tierTasks.week.push(t);
    else if (overdue) chase.push(t);                                // stuck overdue → investigate/chase
    // else: no due date + not actionable + not overdue → not pressing, dropped
  }

  const byDue = (a: Task, z: Task) => (a.due_date ? +new Date(a.due_date) : Infinity) - (z.due_date ? +new Date(z.due_date) : Infinity);
  (Object.keys(tierTasks) as PlanTier[]).forEach(k => tierTasks[k].sort(byDue));
  chase.sort(byDue);
  return { tierTasks, chase, waiting };
}

/** Total schedulable tasks (tiers + chase) — drives the empty/loading states. */
export function dayPlanTaskCount(r: DayPlanResult): number {
  return TIER_META.reduce((n, m) => n + r.tierTasks[m.tier].length, 0) + r.chase.length;
}
