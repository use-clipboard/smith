// Server-side only — HMRC MTD configuration.
//
// SMITH (the product) registers ONCE on the HMRC Developer Hub and gets one set
// of software credentials. These live in env vars (vendor-level, not per-firm).
// Each firm/business then authorises via OAuth, producing per-connection tokens
// stored in `hmrc_connections`.
//
// Stage 1: these env vars are not set yet, so `isHmrcConfigured()` returns false
// and the UI shows a "not set up yet" state. Stage 2 wires the live OAuth +
// submission against the sandbox base URL; production is just an env switch
// after HMRC approval.

/** 'sandbox' (default) or 'production'. Controls the API base URL. */
export const HMRC_ENV = process.env.HMRC_ENV === 'production' ? 'production' : 'sandbox';

/** HMRC API base URL. Sandbox needs no production approval to develop against. */
export const HMRC_BASE_URL = HMRC_ENV === 'production'
  ? 'https://api.service.hmrc.gov.uk'
  : 'https://test-api.service.hmrc.gov.uk';

/** OAuth scopes required for MTD VAT. */
export const HMRC_SCOPES = 'read:vat write:vat';

/** True once the firm-level (vendor) software credentials are configured.
 *  The redirect URI auto-derives from the request host (see resolveRedirectUri),
 *  so only the client id + secret are required as env. */
export function isHmrcConfigured(): boolean {
  return Boolean(process.env.HMRC_CLIENT_ID && process.env.HMRC_CLIENT_SECRET);
}

export function hmrcClientId(): string { return process.env.HMRC_CLIENT_ID ?? ''; }
export function hmrcClientSecret(): string { return process.env.HMRC_CLIENT_SECRET ?? ''; }
export function hmrcRedirectUri(): string { return process.env.HMRC_REDIRECT_URI ?? ''; }
