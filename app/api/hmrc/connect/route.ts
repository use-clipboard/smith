import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { getUserContext } from '@/lib/getUserContext';
import { isHmrcConfigured, scopesForService, type HmrcService } from '@/lib/hmrc/config';
import { buildAuthorizeUrl, resolveRedirectUri } from '@/lib/hmrc/client';

// ── GET /api/hmrc/connect?service=vat|mtd_it&kind=agent|business|individual&bookId=&clientId= ──
// Starts the HMRC OAuth handshake. Stashes a signed-ish state (random nonce +
// context) in an httpOnly cookie, then redirects the user to HMRC's hosted
// login/consent. HMRC returns to /api/hmrc/callback with ?code&state.
//
// service drives the OAuth scope set (VAT vs Self-Assessment) and where the
// callback returns the user. kind selects agent (firm-wide), business (per
// book, VAT) or individual (per client, MTD-IT).
export async function GET(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  if (!isHmrcConfigured()) {
    return NextResponse.json({ error: 'HMRC is not configured for this environment.' }, { status: 400 });
  }

  const url = new URL(req.url);
  const service: HmrcService = url.searchParams.get('service') === 'mtd_it' ? 'mtd_it' : 'vat';
  const rawKind = url.searchParams.get('kind');
  const kind = rawKind === 'business' ? 'business' : rawKind === 'individual' ? 'individual' : 'agent';
  const bookId = url.searchParams.get('bookId') ?? '';
  const clientId = url.searchParams.get('clientId') ?? '';
  // Optional same-origin relative path to return to after the handshake. Must
  // start with a single '/' (not '//') so it can't become an open redirect.
  const returnToRaw = url.searchParams.get('returnTo') ?? '';
  const returnTo = /^\/(?!\/)/.test(returnToRaw) ? returnToRaw : '';

  // Derive the redirect URI from this request's host and persist it, so the
  // callback's token exchange uses the byte-identical value HMRC requires.
  const redirectUri = resolveRedirectUri(req);
  const state = randomBytes(16).toString('hex');
  const res = NextResponse.redirect(buildAuthorizeUrl(state, redirectUri, scopesForService(service)));
  // sameSite 'lax' so the cookie survives the top-level GET redirect back from HMRC.
  res.cookies.set('hmrc_oauth', JSON.stringify({
    state, service, kind, bookId, clientId, firmId: ctx.firmId, redirectUri, returnTo,
  }), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 600,
  });
  return res;
}
