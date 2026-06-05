import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { getBookkeepingContext } from '@/lib/bookkeeping/server';
import { isHmrcConfigured } from '@/lib/hmrc/config';
import { buildAuthorizeUrl, resolveRedirectUri } from '@/lib/hmrc/client';

// ── GET /api/hmrc/connect?kind=agent|business&bookId=<id> ────────────────────
// Starts the HMRC OAuth handshake. Stashes a signed-ish state (random nonce +
// context) in an httpOnly cookie, then redirects the user to HMRC's hosted
// login/consent. HMRC returns to /api/hmrc/callback with ?code&state.
export async function GET(req: NextRequest) {
  const ctx = await getBookkeepingContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  if (!isHmrcConfigured()) {
    return NextResponse.json({ error: 'HMRC is not configured for this environment.' }, { status: 400 });
  }

  const url = new URL(req.url);
  const kind = url.searchParams.get('kind') === 'business' ? 'business' : 'agent';
  const bookId = url.searchParams.get('bookId') ?? '';

  // Derive the redirect URI from this request's host and persist it, so the
  // callback's token exchange uses the byte-identical value HMRC requires.
  const redirectUri = resolveRedirectUri(req);
  const state = randomBytes(16).toString('hex');
  const res = NextResponse.redirect(buildAuthorizeUrl(state, redirectUri));
  // sameSite 'lax' so the cookie survives the top-level GET redirect back from HMRC.
  res.cookies.set('hmrc_oauth', JSON.stringify({ state, kind, bookId, firmId: ctx.firmId, redirectUri }), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 600,
  });
  return res;
}
