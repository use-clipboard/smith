// Server-side only. Generates a Supabase magic-link (token-hash flow) for an
// existing user and sends it via Resend — bypassing Supabase's SMTP entirely
// (which is why this works when supabase.auth.signInWithOtp's email send fails).
//
// Mirrors lib/sendRecoveryEmail.ts: generateLink → token_hash → our own
// /auth/confirm handler (verifyOtp) → session. generateLink('magiclink') only
// succeeds for an existing user, which suits the invite-only login model.
import { createServiceClient } from '@/lib/supabase-server';
import { getBaseUrl } from '@/lib/getBaseUrl';
import { sendMagicLinkEmail } from '@/lib/email';

/**
 * Returns true when an email was sent. Returns false (without throwing) when the
 * address isn't a registered user, so callers can respond without revealing
 * whether an account exists.
 */
export async function sendMagicLink(email: string, next?: string): Promise<boolean> {
  const service = createServiceClient();
  const { data, error } = await service.auth.admin.generateLink({ type: 'magiclink', email });
  if (error) return false;

  const hashedToken = (data?.properties as { hashed_token?: string } | undefined)?.hashed_token;
  if (!hashedToken) return false;

  // Only honour same-site relative destinations (single leading "/") — guards
  // against an open-redirect if a crafted `next` ever reaches here.
  const dest = next && next.startsWith('/') && !next.startsWith('//') ? next : '/dashboard';
  const magicUrl = `${getBaseUrl()}/auth/confirm?token_hash=${encodeURIComponent(hashedToken)}&type=magiclink&next=${encodeURIComponent(dest)}`;

  let name: string | null = null;
  try {
    const { data: u } = await service.from('users').select('full_name').eq('email', email).maybeSingle();
    name = (u as { full_name?: string | null } | null)?.full_name ?? null;
  } catch { /* non-critical */ }

  await sendMagicLinkEmail({ to: email, recipientName: name, magicUrl });
  return true;
}
