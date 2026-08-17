import type { NotificationItem } from '@/components/ui/NotificationsProvider';

// Where a notification takes the user when clicked, and how the pieces talk to
// each other. Shared by the toast (NotificationToastNotifier) and the bell
// dropdown (TopBar) so click-through behaves identically in both.

/** Fired at TopBar to open the right tool tab for a route (reuses its tab map). */
export const NAVIGATE_TAB_EVENT = 'smith:navigate-tab';
/** Deep-link handoff so the Tasks tool opens a specific task after navigation. */
export const OPEN_TASK_EVENT = 'smith:open-task';
export const OPEN_TASK_KEY = 'smith:open-task-id';
/** Broadcast to tell notification-count badges/markers (HR, timesheets, …) to
 *  refetch — fired when the realtime notifications list changes, and directly by
 *  in-tool actions (approve/reject) so a badge updates the instant it's dealt
 *  with, in both the tool and the sidebar. */
export const BADGE_REFRESH_EVENT = 'smith:badge-refresh';

export interface NotificationTarget {
  /** Route/tab to open, or null when there's nowhere meaningful to go. */
  route: string | null;
  /** When set, open this specific task once the Tasks tool is on screen. */
  taskId?: string;
}

/** Resolve where a notification should take the user. */
export function notificationTarget(n: NotificationItem): NotificationTarget {
  const data = (n.data ?? {}) as Record<string, unknown>;

  const taskId = typeof data.task_id === 'string' ? data.task_id : undefined;
  if (taskId) return { route: '/tasks', taskId };

  // Explicit link stored on the notification (task_link, link, or route).
  const explicit = [data.task_link, data.link, data.route].find((v): v is string => typeof v === 'string' && v.length > 0);
  if (explicit) return { route: explicit };

  // Type-based fallbacks.
  if (n.type.startsWith('calendar')) return { route: '/calendar' };
  if (n.type.startsWith('task')) return { route: '/tasks' };
  if (n.type.startsWith('hr') || n.type.includes('holiday') || n.type.includes('leave')) return { route: '/hr' };

  return { route: null };
}

/** Open a specific task in the Tasks tool from anywhere (email panel, timeline,
 *  …). Opens the Tasks tab, then hands the task id off so it opens once mounted
 *  (both a live event and a sessionStorage drain, covering already-mounted and
 *  first-mount cases). No-op on the server or with no id. */
export function openTaskInTool(taskId: string): void {
  if (typeof window === 'undefined' || !taskId) return;
  window.dispatchEvent(new CustomEvent(NAVIGATE_TAB_EVENT, { detail: '/tasks' }));
  try { sessionStorage.setItem(OPEN_TASK_KEY, taskId); } catch { /* ignore */ }
  window.dispatchEvent(new CustomEvent(OPEN_TASK_EVENT, { detail: taskId }));
}

/** Navigate to a notification's destination (opening the right tab, and the
 *  specific task when applicable). No-ops gracefully when there's no route. */
export function goToNotification(n: NotificationItem): void {
  if (typeof window === 'undefined') return;
  const target = notificationTarget(n);
  if (!target.route) {
    // Nowhere specific to go — just surface the bell dropdown.
    window.dispatchEvent(new CustomEvent('smith:open-notifications'));
    return;
  }
  window.dispatchEvent(new CustomEvent(NAVIGATE_TAB_EVENT, { detail: target.route }));
  if (target.taskId) {
    try { sessionStorage.setItem(OPEN_TASK_KEY, target.taskId); } catch { /* ignore */ }
    window.dispatchEvent(new CustomEvent(OPEN_TASK_EVENT, { detail: target.taskId }));
  }
}
