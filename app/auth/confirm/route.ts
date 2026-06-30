import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';
import { randomUUID } from 'crypto';
import { createServiceClient } from '@/lib/supabase-server';
import type { EmailOtpType } from '@supabase/supabase-js';

// ── GET /auth/confirm ────────────────────────────────────────────────────────
// Lands the token-hash email links (password recovery, etc). Verifies the OTP,
// which sets the session cookies, then registers this as the sole session (same
// single-session enforcement as /auth/callback) and forwards to `next`.
//
// Excluded from middleware (see middleware matcher) so it runs without a session
// — verifying the token is exactly what creates the session.
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const token_hash = searchParams.get('token_hash');
  const type = (searchParams.get('type') ?? 'recovery') as EmailOtpType;
  const next = searchParams.get('next') ?? '/reset-password';

  // Recovery failures go back to forgot-password; everything else (magic-link
  // sign-in, etc.) back to the login screen, which surfaces ?error.
  const fail = () => {
    const back = type === 'recovery' ? '/forgot-password' : '/login';
    return NextResponse.redirect(
      `${origin}${back}?error=${encodeURIComponent('This link is invalid or has expired. Please request a new one.')}`,
    );
  };

  if (!token_hash) return fail();

  const cookieStore = cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        },
      },
    },
  );

  const { error } = await supabase.auth.verifyOtp({ type, token_hash });
  if (error) return fail();

  // Resetting a password should end any other live sessions for the account.
  try {
    await supabase.auth.signOut({ scope: 'others' });
  } catch {
    // Non-critical — proceed regardless.
  }

  // Register this as the sole valid session (mirrors /auth/callback).
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      const nonce = randomUUID();
      const service = createServiceClient();
      await service.from('users').update({ active_session_nonce: nonce }).eq('id', user.id);
      const response = NextResponse.redirect(`${origin}${next}`);
      response.cookies.set('smith_snonce', nonce, {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        maxAge: 60 * 60 * 24 * 7,
        path: '/',
      });
      return response;
    }
  } catch {
    // Non-critical — fall through to a plain redirect.
  }

  return NextResponse.redirect(`${origin}${next}`);
}
