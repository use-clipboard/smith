import { createServiceClient } from '@/lib/supabase-server';

// ── Per-user task-change notification preference ─────────────────────────────
// users.notify_task_changes: 'all' | 'oneoff' | 'none' (missing → 'all').

/** Minimal task shape needed to classify a task as recurring/template/spawned. */
export type TaskKind = { recurrence_type?: string | null; template_id?: string | null; parent_task_id?: string | null };

/** A task is "recurring/template" if it recurs, came from a template, or is a spawned occurrence. */
export function isRecurringOrTemplateTask(t: TaskKind | null | undefined): boolean {
  if (!t) return false;
  return (!!t.recurrence_type && t.recurrence_type !== 'once') || !!t.template_id || !!t.parent_task_id;
}

/**
 * Filter candidate recipients of a task-CHANGE notification by their own
 * preference (users.notify_task_changes). 'none' → never; 'oneoff' → dropped
 * when the task is recurring/template/spawned; 'all'/missing → always.
 */
export async function filterTaskChangeRecipients(
  userIds: Array<string | null | undefined>,
  task: TaskKind | null | undefined,
): Promise<Set<string>> {
  const ids = [...new Set(userIds.filter((v): v is string => !!v))];
  if (ids.length === 0) return new Set();
  const service = createServiceClient();
  const { data } = await service.from('users').select('id, notify_task_changes').in('id', ids);
  const recurring = isRecurringOrTemplateTask(task);
  const prefById = new Map<string, string>(
    (data ?? []).map((u: { id: string; notify_task_changes: string | null }) => [u.id, u.notify_task_changes ?? 'all']),
  );
  const allowed = new Set<string>();
  for (const id of ids) {
    const pref = prefById.get(id) ?? 'all'; // unknown row → default to notifying
    if (pref === 'none') continue;
    if (pref === 'oneoff' && recurring) continue;
    allowed.add(id);
  }
  return allowed;
}

/**
 * Notify assignees when task steps are assigned to them.
 * Groups by assignee (one notification per person per task), skips self-assignments.
 * Respects each assignee's notify_task_changes preference when `task` is given.
 */
export async function notifyTaskStepAssignments({
  actorUserId,
  firmId,
  taskId,
  taskTitle,
  assignments,
  task,
}: {
  actorUserId: string;
  firmId: string;
  taskId: string;
  taskTitle: string;
  /** Each step that has an assignee. Null/undefined assigneeId entries are ignored. */
  assignments: Array<{ assigneeId: string | null | undefined; stepTitle: string }>;
  /** The task's recurrence/template info, so 'oneoff'/'none' assignees can be filtered. */
  task?: TaskKind;
}): Promise<void> {
  // Filter out unassigned steps and self-assignments
  const valid = assignments.filter(
    a => a.assigneeId && a.assigneeId !== actorUserId
  ) as Array<{ assigneeId: string; stepTitle: string }>;
  if (!valid.length) return;

  const service = createServiceClient();

  // Look up actor name for the notification body
  const { data: actor } = await service
    .from('users')
    .select('full_name, email')
    .eq('id', actorUserId)
    .single();
  const actorName = (actor?.full_name as string | null) || (actor?.email as string | null) || 'A team member';

  // Group steps by assignee
  const byAssignee = new Map<string, string[]>();
  for (const a of valid) {
    if (!byAssignee.has(a.assigneeId)) byAssignee.set(a.assigneeId, []);
    byAssignee.get(a.assigneeId)!.push(a.stepTitle);
  }

  // Drop assignees who don't want this kind of task-change notification.
  const allowed = await filterTaskChangeRecipients([...byAssignee.keys()], task);

  const rows = Array.from(byAssignee.entries()).filter(([userId]) => allowed.has(userId)).map(([userId, stepTitles]) => ({
    user_id: userId,
    firm_id: firmId,
    type: 'task_assigned',
    title: `Assigned to you: ${taskTitle}`,
    body:
      stepTitles.length === 1
        ? `Step: ${stepTitles[0]} — by ${actorName}`
        : `${stepTitles.length} steps assigned by ${actorName}`,
    data: { task_id: taskId, task_link: '/tasks' },
  }));

  if (rows.length === 0) return; // every assignee opted out for this task kind
  const { error } = await service.from('notifications').insert(rows);
  if (error) console.error('Failed to create task assignment notifications:', error);
}

/**
 * Clear the "assigned to you" notifications for a task once it's completed, so
 * they drop off the assignee's bell (and any toast) in real time — the user has
 * effectively dealt with them by finishing the task. Matches on the jsonb
 * task_id; uses the service client to bypass RLS (like the rest of this file).
 */
export async function deleteTaskNotifications(taskId: string): Promise<void> {
  if (!taskId) return;
  const service = createServiceClient();
  const { error } = await service
    .from('notifications')
    .delete()
    .eq('type', 'task_assigned')
    .eq('data->>task_id', taskId);
  if (error) console.error('Failed to delete task notifications:', error);
}

/** Create a single in-app notification for a user. Uses service client to bypass RLS. */
export async function createNotification({
  userId, firmId, type, title, body, data,
}: {
  userId: string;
  firmId: string;
  type: string;
  title: string;
  body?: string;
  data?: Record<string, unknown>;
}): Promise<void> {
  const service = createServiceClient();
  const { error } = await service.from('notifications').insert({
    user_id: userId,
    firm_id: firmId,
    type,
    title,
    body: body ?? null,
    data: data ?? null,
  });
  if (error) console.error('Failed to create notification:', error);
}

/**
 * Notify SMITH team members (in the same firm) whose emails appear in attendeeEmails,
 * excluding the actor who triggered the action.
 * Only fires if there are matching users.
 */
export async function notifyCalendarAttendees({
  actorUserId,
  firmId,
  attendeeEmails,
  type,
  title,
  body,
  data,
}: {
  actorUserId: string;
  firmId: string;
  attendeeEmails: string[];
  type: string;
  title: string;
  body?: string;
  data?: Record<string, unknown>;
}): Promise<void> {
  if (!attendeeEmails.length) return;

  const service = createServiceClient();
  const { data: targets } = await service
    .from('users')
    .select('id')
    .eq('firm_id', firmId)
    .in('email', attendeeEmails)
    .neq('id', actorUserId);

  if (!targets?.length) return;

  const rows = targets.map(u => ({
    user_id: u.id,
    firm_id: firmId,
    type,
    title,
    body: body ?? null,
    data: data ?? null,
  }));

  const { error } = await service.from('notifications').insert(rows);
  if (error) console.error('Failed to create calendar notifications:', error);
}
