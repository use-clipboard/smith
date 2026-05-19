// Filter helpers that apply the firm's client-status policy + per-session
// "show on-hold / show inactive" toggles to a raw task list. Imported by
// each view that renders TaskListRow / TaskCard.

import type { Task } from '@/types';
import type { TaskClientStatusPolicy } from '@/lib/taskClientStatusPolicy';

interface VisibilityOpts {
  policy: TaskClientStatusPolicy;
  showOnHold:    boolean;
  showInactive:  boolean;
}

/** Should this task be hidden from a default view based on its client's
 *  status + the firm's policy + the per-session opt-in toggles? */
export function isHiddenByClientStatus(task: Task, opts: VisibilityOpts): boolean {
  const status = (task.client as { status?: string | null } | null | undefined)?.status ?? null;
  if (status === 'hold' && opts.policy.on_hold.hide_from_default && !opts.showOnHold) return true;
  if (status === 'inactive' && opts.policy.inactive.hide_from_default && !opts.showInactive) return true;
  return false;
}

/** Apply both rules to a task list — returns a new array. */
export function applyClientStatusVisibility(tasks: Task[], opts: VisibilityOpts): Task[] {
  return tasks.filter(t => !isHiddenByClientStatus(t, opts));
}

/** Returns counts of how many tasks were filtered, so the UI can show a
 *  "12 on-hold tasks hidden · show" affordance. */
export function countsHiddenByClientStatus(tasks: Task[], opts: VisibilityOpts): { onHold: number; inactive: number } {
  let onHold = 0;
  let inactive = 0;
  for (const t of tasks) {
    const status = (t.client as { status?: string | null } | null | undefined)?.status ?? null;
    if (status === 'hold' && opts.policy.on_hold.hide_from_default && !opts.showOnHold) onHold++;
    else if (status === 'inactive' && opts.policy.inactive.hide_from_default && !opts.showInactive) inactive++;
  }
  return { onHold, inactive };
}

/** Should an on-hold task contribute to the overdue / due-in-7d headline
 *  chips? Inactive tasks are always excluded; on-hold respects policy. */
export function isExcludedFromOverdueCounts(task: Task, policy: TaskClientStatusPolicy): boolean {
  const status = (task.client as { status?: string | null } | null | undefined)?.status ?? null;
  if (status === 'inactive') return true;
  if (status === 'hold' && policy.on_hold.exclude_from_overdue) return true;
  return false;
}
