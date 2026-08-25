// Server-side only — resolve a firm's HMRC SA100 (legacy GovTalk) filing
// credentials. Prefers the firm's own stored credentials (Settings → Tax Studio),
// falling back to the env vars (single-firm internal pilot). Mirrors
// lib/getAnthropicForFirm.ts.
//
// The Vendor ID is global (SMITH's software id) and always comes from env — only
// the SenderID + password are per-firm. The password is stored AES-256-GCM
// encrypted (lib/crypto/secretBox.ts) and decrypted here at submission time.

import { createServiceClient } from '@/lib/supabase-server';
import { decryptSecret } from '@/lib/crypto/secretBox';
import { saSenderId, saPassword, saVendorId, type SaCreds } from './config';

/** Thrown when SA online filing has no usable credentials for the firm. */
export class SaFilingNotConfiguredError extends Error {
  constructor(msg?: string) {
    super(msg || 'SA online filing is not set up. Ask your admin to add your HMRC Government Gateway credentials in Settings → Tax Studio.');
    this.name = 'SaFilingNotConfiguredError';
  }
}

interface FirmSaRow { sa_gateway_sender_id: string | null; sa_gateway_password_enc: string | null }

/**
 * Resolve creds (firm store → env fallback). Returns null if incomplete.
 * Throws only if firm-stored ciphertext exists but cannot be decrypted.
 */
export async function resolveSaCreds(firmId: string): Promise<(SaCreds & { source: 'firm' | 'env' }) | null> {
  const service = createServiceClient();
  const { data } = await service
    .from('firms').select('sa_gateway_sender_id, sa_gateway_password_enc').eq('id', firmId).single();
  const row = (data ?? null) as FirmSaRow | null;
  const vendorId = saVendorId(); // global — SMITH's software id

  // Firm-stored credentials take precedence.
  if (row?.sa_gateway_sender_id && row?.sa_gateway_password_enc) {
    let password: string;
    try {
      password = decryptSecret(row.sa_gateway_password_enc);
    } catch {
      throw new SaFilingNotConfiguredError('Your stored HMRC credentials could not be decrypted (the server encryption key is missing or has changed). Please re-enter them in Settings → Tax Studio.');
    }
    if (vendorId) return { senderId: row.sa_gateway_sender_id, password, vendorId, source: 'firm' };
  }

  // Fallback: env vars (internal single-firm pilot).
  const envSender = saSenderId(), envPw = saPassword();
  if (envSender && envPw && vendorId) return { senderId: envSender, password: envPw, vendorId, source: 'env' };

  return null;
}

/** Resolve creds or throw a user-facing error. Use at submission time. */
export async function getSaCredsForFirm(firmId: string): Promise<SaCreds> {
  const resolved = await resolveSaCreds(firmId);
  if (!resolved) throw new SaFilingNotConfiguredError();
  const { senderId, password, vendorId } = resolved;
  return { senderId, password, vendorId };
}

/** Non-throwing status for the settings UI / filing card. Never returns the password. */
export async function getSaFilingStatus(firmId: string): Promise<{
  configured: boolean; senderId: string | null; source: 'firm' | 'env' | null; vendorIdConfigured: boolean;
}> {
  const vendorIdConfigured = !!saVendorId();
  try {
    const creds = await resolveSaCreds(firmId);
    return { configured: !!creds, senderId: creds?.senderId ?? null, source: creds?.source ?? null, vendorIdConfigured };
  } catch {
    // Undecryptable stored ciphertext ⇒ surface as not configured (admin must re-enter).
    return { configured: false, senderId: null, source: null, vendorIdConfigured };
  }
}
