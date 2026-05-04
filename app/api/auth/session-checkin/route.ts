import { NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { createClient, createServiceClient } from '@/lib/supabase-server';

// Called immediately after login to register the current session as the only
// valid one. Writes a nonce to the DB and sets it as an HttpOnly cookie.
// Middleware rejects any request whose cookie nonce doesn't match the DB.
export async function POST() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });

  const nonce = randomUUID();
  const service = createServiceClient();
  await service.from('users').update({ active_session_nonce: nonce }).eq('id', user.id);

  const response = NextResponse.json({ ok: true });
  response.cookies.set('smith_snonce', nonce, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 60 * 60 * 24 * 7,
    path: '/',
  });
  return response;
}
