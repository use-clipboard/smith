import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';
import { randomUUID } from 'crypto';
import { createServiceClient } from '@/lib/supabase-server';

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const next = searchParams.get('next') ?? '/dashboard';
  const kickOthers = searchParams.get('kick_others') === '1';

  if (code) {
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
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          },
        },
      }
    );

    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      if (kickOthers) {
        try {
          await supabase.auth.signOut({ scope: 'others' });
        } catch {
          // Non-critical — proceed regardless
        }
      }

      // Register this as the sole valid session
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
        // Non-critical — fall through to plain redirect
      }

      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  return NextResponse.redirect(`${origin}/login?error=Could not sign in. Please try again.`);
}
