// Shared helper: resolve the "also notify these team members" recipient list
// used by the Accounts Studio + MTD IT client-approval flows.
//
// Given the configured user ids (from firm settings), returns the firm users to
// additionally notify — filtered to the firm, de-duplicated, excluding the
// person who sent the approval (they're notified anyway) and anyone without an
// email. Server-side only.

import { createServiceClient } from '@/lib/supabase-server';

export interface NotifyRecipient {
  id: string;
  email: string;
  fullName: string | null;
}

export async function resolveNotifyRecipients(
  firmId: string | null | undefined,
  userIds: unknown,
  excludeUserId: string | null,
): Promise<NotifyRecipient[]> {
  if (!firmId) return [];
  const ids = [...new Set(
    (Array.isArray(userIds) ? userIds : [])
      .filter((v): v is string => typeof v === 'string' && !!v && v !== excludeUserId),
  )];
  if (!ids.length) return [];

  const service = createServiceClient();
  const { data } = await service
    .from('users')
    .select('id, email, full_name')
    .eq('firm_id', firmId)
    .in('id', ids);

  return (data ?? [])
    .filter(u => typeof u.email === 'string' && u.email)
    .map(u => ({ id: u.id as string, email: u.email as string, fullName: (u.full_name as string | null) ?? null }));
}
