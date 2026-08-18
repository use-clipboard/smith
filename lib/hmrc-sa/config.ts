// Config for the legacy SA100 GovTalk submission (server-side only).
//
// Vendor + Government Gateway agent credentials come from env vars for the
// internal single-firm setup (mirroring lib/companiesHouse/config.ts). ⚠ For
// multi-firm SaaS these move to a per-firm encrypted store (Phase 3) — the
// firm's OLD-STYLE Gov Gateway SA-agent credentials, not the MTD ASA.

/** GovTalk message Class for the SA100 individual return. */
export const SA_CLASS = 'HMRC-SA-SA100';

/** Transaction Engine endpoint. Default = TPVS (test); set HMRC_SA_ENV=production for live. */
export function saGatewayUrl(): string {
  return process.env.HMRC_SA_ENV === 'production'
    ? (process.env.HMRC_SA_GATEWAY_URL || 'https://transaction-engine.tax.service.gov.uk/submission')
    : (process.env.HMRC_SA_TEST_URL || 'https://test-transaction-engine.tax.service.gov.uk/submission');
}

/** GatewayTest flag — '1' against TPVS, '0' in production. */
export function saGatewayTestFlag(): '0' | '1' {
  return process.env.HMRC_SA_ENV === 'production' ? '0' : '1';
}

/** The agent's Government Gateway user id (SenderID). */
export function saSenderId(): string {
  return process.env.HMRC_SA_SENDER_ID || '';
}

/** The agent's Government Gateway password (sent with Method=clear over TLS). */
export function saPassword(): string {
  return process.env.HMRC_SA_PASSWORD || '';
}

/** Vendor ID issued by HMRC on SA recognition (goes in ChannelRouting). */
export function saVendorId(): string {
  return process.env.HMRC_SA_VENDOR_ID || '';
}

export const SA_PRODUCT = 'SMITH';
export function saProductVersion(): string {
  return process.env.HMRC_SA_PRODUCT_VERSION || '1.0';
}

/** True when the Gateway credentials + vendor id are all present. */
export function isSaFilingConfigured(): boolean {
  return !!(saSenderId() && saPassword() && saVendorId());
}
