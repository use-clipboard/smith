// Server-side only — Companies House XML Gateway configuration.
//
// Statutory-accounts filing to Companies House goes over the XML Gateway (a
// GovTalk/SOAP-style endpoint), NOT the read-only CH REST API used elsewhere in
// SMITH for company lookups. This is a separate credential set: a PRESENTER ID +
// AUTHENTICATION VALUE issued by the CH XML team, plus a per-company
// authentication code supplied at submission time.
//
// The firm registers ONCE with the CH XML team and gets one presenter account
// per environment (test, then live). These live in env vars — never per-firm,
// never client-side. Until they're set, isChGatewayConfigured() is false and the
// UI shows a "not set up" state.
//
// ── Environment ──────────────────────────────────────────────────────────────
// CH_XMLGW_PRESENTER_ID   Test/live presenter id (e.g. the test id 66666651000)
// CH_XMLGW_AUTH_VALUE     Authentication value issued with the presenter id
// CH_XMLGW_PACKAGE_REF    Test package reference (e.g. 0012); omit for live
// CH_XMLGW_ENV            'test' (default) | 'live'  — sets the GatewayTest flag
// CH_XMLGW_URL            Override the gateway URL (defaults below)

/** 'test' (default) or 'live'. Controls the GatewayTest flag only — the gateway
 *  URL is the same for both; the presenter account determines the environment. */
export const CH_XMLGW_ENV = process.env.CH_XMLGW_ENV === 'live' ? 'live' : 'test';

/** The XML Gateway submission endpoint. Same host for test and live filing; the
 *  GatewayTest flag + test presenter id are what make a submission a test. */
export const CH_XMLGW_URL =
  (process.env.CH_XMLGW_URL ?? '').trim() ||
  'https://xmlgw.companieshouse.gov.uk/v1-0/xmlgw/Gateway';

/** GatewayTest flag value: '1' for test submissions, '0' for live. */
export const CH_GATEWAY_TEST_FLAG = CH_XMLGW_ENV === 'live' ? '0' : '1';

// Trim credentials — a stray newline pasted into an env var otherwise produces
// an opaque authentication failure that's painful to diagnose over the gateway.
export function chPresenterId(): string { return (process.env.CH_XMLGW_PRESENTER_ID ?? '').trim(); }
export function chAuthValue(): string { return (process.env.CH_XMLGW_AUTH_VALUE ?? '').trim(); }
export function chPackageReference(): string { return (process.env.CH_XMLGW_PACKAGE_REF ?? '').trim(); }

/** True once the presenter credentials are configured. */
export function isChGatewayConfigured(): boolean {
  return Boolean(chPresenterId() && chAuthValue());
}
