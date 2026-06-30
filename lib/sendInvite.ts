// Server-side only. Sends a branded team-invite email via Resend (NOT Supabase
// SMTP, which is broken). The invited user already exists (created confirmed but
// password-less by the invite route); this emails them a one-time link to set
// their password and land in the app.
//
// Mechanically identical to the recovery flow — generateLink('recovery') →
// token_hash → /auth/confirm → /reset-password — but with invite-flavoured copy
// (the set-password page reads ?flow=invite to say "Welcome" rather than "reset").
// Reused for both the first invite and "resend invite".
import { createServiceClient } from '@/lib/supabase-server';
import { getBaseUrl } from '@/lib/getBaseUrl';
import { sendInviteEmail } from '@/lib/email';

/**
 * Returns true when the invite email was sent, false (without throwing) if the
 * address isn't a registered user.
 */
export async function sendInvite(email: string): Promise<boolean> {
  const service = createServiceClient();
  const { data, error } = await service.auth.admin.generateLink({ type: 'recovery', email });
  if (error) return false;

  const hashedToken = (data?.properties as { hashed_token?: string } | undefined)?.hashed_token;
  if (!hashedToken) return false;

  const inviteUrl = `${getBaseUrl()}/auth/confirm?token_hash=${encodeURIComponent(hashedToken)}&type=recovery&next=${encodeURIComponent('/reset-password?flow=invite')}`;

  // Friendly greeting + firm name for the email body.
  let name: string | null = null;
  let firmName: string | null = null;
  try {
    const { data: u } = await service
      .from('users')
      .select('full_name, firm:firms(name)')
      .eq('email', email)
      .maybeSingle();
    name = (u as { full_name?: string | null } | null)?.full_name ?? null;
    const firmRaw = (u as { firm?: unknown } | null)?.firm;
    const firmObj = Array.isArray(firmRaw) ? firmRaw[0] : firmRaw;
    firmName = (firmObj as { name?: string | null } | null)?.name ?? null;
  } catch { /* non-critical */ }

  await sendInviteEmail({ to: email, recipientName: name, firmName, inviteUrl });
  return true;
}
