// Account / personal-data deletion helpers.
//
// Backs the in-app "Delete my account & data" flow. Centralises the logic for
// revoking a user's Google access at Google (not just deleting our stored row)
// and for fully removing a user + their personal data. Used by the user's
// deletion-request handler (revoke now) and the admin's complete-deletion
// handler (full removal).

import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Revoke a Google OAuth token at Google's revocation endpoint so it can no
 * longer be used, even if the value leaked. Best-effort — failures are logged
 * but never block deletion of our own stored copy.
 */
export async function revokeGoogleToken(token: string | null | undefined): Promise<void> {
  if (!token) return;
  try {
    await fetch('https://oauth2.googleapis.com/revoke', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `token=${encodeURIComponent(token)}`,
    });
  } catch (e) {
    console.error('Google token revoke failed:', e);
  }
}

/**
 * Revoke + delete a user's PERSONAL Google connections (Gmail + Calendar).
 * Google Drive is a firm-level connection shared by the whole team, so it is
 * intentionally left untouched here.
 */
export async function revokeUserGoogleConnections(service: SupabaseClient, userId: string): Promise<void> {
  // Gmail (email_connections: access_token, refresh_token)
  const { data: gmail } = await service
    .from('email_connections')
    .select('access_token, refresh_token')
    .eq('user_id', userId)
    .maybeSingle();
  if (gmail) {
    await revokeGoogleToken(gmail.refresh_token as string | null);
    await revokeGoogleToken(gmail.access_token as string | null);
    await service.from('email_connections').delete().eq('user_id', userId);
  }

  // Calendar (calendar_tokens: google_access_token, google_refresh_token)
  const { data: cal } = await service
    .from('calendar_tokens')
    .select('google_access_token, google_refresh_token')
    .eq('user_id', userId)
    .maybeSingle();
  if (cal) {
    await revokeGoogleToken(cal.google_refresh_token as string | null);
    await revokeGoogleToken(cal.google_access_token as string | null);
    await service.from('calendar_tokens').delete().eq('user_id', userId);
  }
}

/**
 * Fully delete a user and their personal data. Revokes Google tokens, removes
 * the rows that lack ON DELETE CASCADE, deletes the user row (cascade handles
 * the rest of the per-user tables), then deletes the auth account.
 *
 * The CALLER is responsible for authorisation (admin + last-admin guard) — this
 * helper just performs the deletion.
 */
export async function deleteUserCompletely(
  service: SupabaseClient,
  userId: string,
  firmId: string,
): Promise<void> {
  await revokeUserGoogleConnections(service, userId);

  // Tables that reference user_id WITHOUT ON DELETE CASCADE — remove explicitly
  // so the delete doesn't fail / orphan rows.
  await service.from('email_allocations').delete().eq('user_id', userId);
  await service.from('email_task_links').delete().eq('user_id', userId);

  // Delete the public.users row — cascades to the remaining per-user tables
  // (notifications, chat_messages, sticky notes, reactions, community, etc.).
  await service.from('users').delete().eq('id', userId).eq('firm_id', firmId);

  // Finally remove the auth account.
  await service.auth.admin.deleteUser(userId);
}
