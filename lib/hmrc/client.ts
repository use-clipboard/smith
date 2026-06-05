// Server-side only — HMRC OAuth 2.0 helpers (Stage 2a).
//
// Covers the authorization-code grant used to connect a firm/business to HMRC:
//   • buildAuthorizeUrl  — where we send the user to log in + consent
//   • exchangeCodeForTokens — swap the returned code for access/refresh tokens
//   • refreshTokens      — renew an expired access token
//
// NOTE: the /oauth/token endpoints do NOT require fraud-prevention headers —
// those are only needed on the VAT API calls (obligations, returns), which land
// in Stage 2b. Keeping this file purely about the OAuth handshake.

import { HMRC_BASE_URL, HMRC_SCOPES, hmrcClientId, hmrcClientSecret, hmrcRedirectUri } from './config';

/**
 * The OAuth redirect URI. Auto-derived from the request host so localhost and
 * each deployment (e.g. smith-blush.vercel.app) work without per-environment
 * config — as long as the matching `<origin>/api/hmrc/callback` is registered
 * on the HMRC Developer Hub. `HMRC_REDIRECT_URI` env, if set, overrides this.
 */
export function resolveRedirectUri(req: Request): string {
  const override = hmrcRedirectUri();
  if (override) return override;
  const u = new URL(req.url);
  const proto = req.headers.get('x-forwarded-proto') ?? u.protocol.replace(':', '') ?? 'https';
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? u.host;
  return `${proto}://${host}/api/hmrc/callback`;
}

export interface HmrcTokens {
  access_token: string;
  refresh_token: string;
  /** Seconds until the access token expires (HMRC returns 14400 = 4h). */
  expires_in: number;
  scope?: string;
  token_type: string;
}

/** The HMRC hosted login + consent screen. */
export function buildAuthorizeUrl(state: string, redirectUri: string): string {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: hmrcClientId(),
    scope: HMRC_SCOPES,
    state,
    redirect_uri: redirectUri,
  });
  return `${HMRC_BASE_URL}/oauth/authorize?${params.toString()}`;
}

async function tokenRequest(body: URLSearchParams): Promise<HmrcTokens> {
  const res = await fetch(`${HMRC_BASE_URL}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`HMRC token request failed (${res.status}): ${text}`);
  return JSON.parse(text) as HmrcTokens;
}

export function exchangeCodeForTokens(code: string, redirectUri: string): Promise<HmrcTokens> {
  return tokenRequest(new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: hmrcClientId(),
    client_secret: hmrcClientSecret(),
    redirect_uri: redirectUri,
    code,
  }));
}

export function refreshTokens(refreshToken: string): Promise<HmrcTokens> {
  return tokenRequest(new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: hmrcClientId(),
    client_secret: hmrcClientSecret(),
    refresh_token: refreshToken,
  }));
}

/** ISO timestamp `expires_in` seconds from now, for storing token_expiry. */
export function expiryFromNow(expiresIn: number): string {
  return new Date(Date.now() + Math.max(0, (expiresIn - 60)) * 1000).toISOString();
}
