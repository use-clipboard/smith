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

/** The HMRC services SMITH integrates with. */
export type HmrcService = 'vat' | 'mtd_it';

/** OAuth scopes per service. VAT and Income Tax use distinct scope sets. */
export const HMRC_VAT_SCOPES = 'read:vat write:vat';
export const HMRC_MTD_IT_SCOPES = 'read:self-assessment write:self-assessment';

/** OAuth scopes required for MTD VAT. Kept for back-compat (defaults to VAT). */
export const HMRC_SCOPES = HMRC_VAT_SCOPES;

/** Resolve the OAuth scope string for a given HMRC service. */
export function scopesForService(service: HmrcService): string {
  return service === 'mtd_it' ? HMRC_MTD_IT_SCOPES : HMRC_VAT_SCOPES;
}

/** True once the firm-level (vendor) software credentials are configured.
 *  The redirect URI auto-derives from the request host (see resolveRedirectUri),
 *  so only the client id + secret are required as env. */
export function isHmrcConfigured(): boolean {
  return Boolean(process.env.HMRC_CLIENT_ID && process.env.HMRC_CLIENT_SECRET);
}

// Trim the credentials — a client id/secret never contains surrounding
// whitespace, and a stray space/tab/newline pasted into an env var (a common
// dashboard mistake) otherwise causes an opaque 401 invalid_client.
export function hmrcClientId(): string { return (process.env.HMRC_CLIENT_ID ?? '').trim(); }
export function hmrcClientSecret(): string { return (process.env.HMRC_CLIENT_SECRET ?? '').trim(); }
export function hmrcRedirectUri(): string { return (process.env.HMRC_REDIRECT_URI ?? '').trim(); }
