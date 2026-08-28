// Config for the CT600 GovTalk / Corporation Tax Online submission (server-side).
//
// Mirrors lib/hmrc-sa/config.ts. Vendor + Government Gateway credentials come from
// env vars for the internal single-firm setup; for multi-firm SaaS they move to a
// per-firm encrypted store (Phase E) — see docs/ct-filing.md.
//
// ⚠ The CT600 vendor / product ID is a SEPARATE HMRC recognition from the SA100
// vendor (9626), the Companies House presenter account, and the MTD OAuth creds.

/** GovTalk message Class for the CT600 Company Tax Return. */
export const CT_CLASS = 'HMRC-CT-CT600';

/** Resolved Government Gateway credentials for a CT submission (firm store or env). */
export interface CtCreds {
  /** Gateway user id (goes in <SenderID>). */
  senderId: string;
  /** Gateway password (sent with Method=clear over TLS). */
  password: string;
  /** HMRC-issued CT Vendor ID (goes in ChannelRouting <URI>). Global to SMITH. */
  vendorId: string;
}

/** Transaction Engine endpoint. Default = test; set HMRC_CT_ENV=production for live. */
export function ctGatewayUrl(): string {
  return process.env.HMRC_CT_ENV === 'production'
    ? (process.env.HMRC_CT_GATEWAY_URL || 'https://transaction-engine.tax.service.gov.uk/submission')
    : (process.env.HMRC_CT_TEST_URL || 'https://test-transaction-engine.tax.service.gov.uk/submission');
}

/** GatewayTest flag — '1' against the test engine, '0' in production. */
export function ctGatewayTestFlag(): '0' | '1' {
  return process.env.HMRC_CT_ENV === 'production' ? '0' : '1';
}

/** The agent's Government Gateway user id (SenderID). */
export function ctSenderId(): string {
  return process.env.HMRC_CT_SENDER_ID || '';
}

/** The agent's Government Gateway password (sent with Method=clear over TLS). */
export function ctPassword(): string {
  return process.env.HMRC_CT_PASSWORD || '';
}

/** Vendor ID issued by HMRC on CT600 recognition (goes in ChannelRouting). */
export function ctVendorId(): string {
  return process.env.HMRC_CT_VENDOR_ID || '';
}

export const CT_PRODUCT = 'SMITH';
export function ctProductVersion(): string {
  return process.env.HMRC_CT_PRODUCT_VERSION || '1.0';
}

/** True when the Gateway credentials + vendor id are all present. */
export function isCtFilingConfigured(): boolean {
  return !!(ctSenderId() && ctPassword() && ctVendorId());
}
