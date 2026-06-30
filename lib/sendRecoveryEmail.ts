// Server-side only. Generates a Supabase recovery link (token-hash flow) for an
// email and sends it via Resend. Used by both the self-service forgot-password
// route and the admin "reset password" action so the delivery is identical.
//
// We deliberately use generateLink + our own /auth/confirm handler (token_hash +
// verifyOtp) rather than resetPasswordForEmail's PKCE `code` flow: the token-hash
// flow has no per-browser code verifier, so an admin can trigger a reset that the
// user completes in their own browser.
import { createServiceClient } from '@/lib/supabase-server';
import { getBaseUrl } from '@/lib/getBaseUrl';
import { sendPasswordResetEmail } from '@/lib/email';

interface Options {
  email: string;
  /** True when an admin triggered it — tweaks the email copy. */
  byAdmin?: boolean;
}

/**
 * Returns true when an email was sent. Returns false (without throwing) when the
 * address isn't registered, so callers can respond without revealing whether an
 * account exists.
 */
export async function sendRecoveryEmail({ email, byAdmin }: Options): Promise<boolean> {
  const service = createServiceClient();
  const { data, error } = await service.auth.admin.generateLink({ type: 'recovery', email });
  if (error) return false;

  const hashedToken = (data?.properties as { hashed_token?: string } | undefined)?.hashed_token;
  if (!hashedToken) return false;

  const resetUrl = `${getBaseUrl()}/auth/confirm?token_hash=${encodeURIComponent(hashedToken)}&type=recovery&next=${encodeURIComponent('/reset-password')}`;

  // Best-effort recipient name for a friendlier greeting.
  let name: string | null = null;
  try {
    const { data: u } = await service.from('users').select('full_name').eq('email', email).maybeSingle();
    name = (u as { full_name?: string | null } | null)?.full_name ?? null;
  } catch { /* non-critical */ }

  await sendPasswordResetEmail({ to: email, recipientName: name, resetUrl, byAdmin });
  return true;
}
