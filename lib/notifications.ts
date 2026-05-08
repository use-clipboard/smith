import { createServiceClient } from '@/lib/supabase-server';

/**
 * Notify assignees when task steps are assigned to them.
 * Groups by assignee (one notification per person per task), skips self-assignments.
 */
export async function notifyTaskStepAssignments({
  actorUserId,
  firmId,
  taskId,
  taskTitle,
  assignments,
}: {
  actorUserId: string;
  firmId: string;
  taskId: string;
  taskTitle: string;
  /** Each step that has an assignee. Null/undefined assigneeId entries are ignored. */
  assignments: Array<{ assigneeId: string | null | undefined; stepTitle: string }>;
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

  const rows = Array.from(byAssignee.entries()).map(([userId, stepTitles]) => ({
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

  const { error } = await service.from('notifications').insert(rows);
  if (error) console.error('Failed to create task assignment notifications:', error);
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
