import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

export async function middleware(request: NextRequest) {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    return NextResponse.next({ request });
  }

  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const { data: { user } } = await supabase.auth.getUser();

  const isAuthRoute = request.nextUrl.pathname.startsWith('/login') ||
    request.nextUrl.pathname.startsWith('/signup');

  // Public-by-token routes (proposal accept page + its API). No auth required.
  const isPublicProposal =
    request.nextUrl.pathname.startsWith('/p/') ||
    request.nextUrl.pathname.startsWith('/api/p/');

  if (!user && !isAuthRoute && !isPublicProposal) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    return NextResponse.redirect(url);
  }

  if (user && isAuthRoute) {
    const url = request.nextUrl.clone();
    url.pathname = '/dashboard';
    return NextResponse.redirect(url);
  }

  // Single-session enforcement: verify the cookie nonce matches the DB nonce.
  // If another device has logged in since, their login overwrites the DB nonce,
  // causing this check to fail and immediately signing this session out.
  // Skipped in local dev to avoid conflicts between the dev server and production.
  if (user && process.env.SUPABASE_SERVICE_ROLE_KEY && process.env.NODE_ENV === 'production') {
    const cookieNonce = request.cookies.get('smith_snonce')?.value;
    if (cookieNonce) {
      try {
        const service = createServerClient(
          process.env.NEXT_PUBLIC_SUPABASE_URL,
          process.env.SUPABASE_SERVICE_ROLE_KEY,
          { cookies: { getAll: () => [], setAll: () => {} } }
        );
        const { data } = await service
          .from('users')
          .select('active_session_nonce')
          .eq('id', user.id)
          .single();

        if (data && data.active_session_nonce && data.active_session_nonce !== cookieNonce) {
          // Another session has taken over — sign this one out immediately
          await supabase.auth.signOut();
          const url = request.nextUrl.clone();
          url.pathname = '/login';
          url.searchParams.set('error', 'You have been signed out because your account was accessed from another device.');
          const redirect = NextResponse.redirect(url);
          redirect.cookies.delete('smith_snonce');
          return redirect;
        }
      } catch {
        // Non-critical — if the check fails, allow through rather than blocking
      }
    }
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|auth/callback|.*\\.(?:png|jpg|jpeg|gif|svg|ico|webp)).*)',
  ],
};
