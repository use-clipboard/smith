import { createServiceClient } from '@/lib/supabase-server';

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
