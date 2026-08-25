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
 * Gateway credentials only (SenderID + password), firm store → env fallback,
 * INDEPENDENT of the global Vendor ID. Returns null if none are stored.
 * Throws SaFilingNotConfiguredError only if firm-stored ciphertext won't decrypt.
 */
async function readGatewayCreds(firmId: string): Promise<{ senderId: string; password: string; source: 'firm' | 'env' } | null> {
  const service = createServiceClient();
  const { data } = await service
    .from('firms').select('sa_gateway_sender_id, sa_gateway_password_enc').eq('id', firmId).single();
  const row = (data ?? null) as FirmSaRow | null;

  if (row?.sa_gateway_sender_id && row?.sa_gateway_password_enc) {
    let password: string;
    try {
      password = decryptSecret(row.sa_gateway_password_enc);
    } catch {
      throw new SaFilingNotConfiguredError('Your stored HMRC credentials could not be decrypted (the server encryption key is missing or has changed). Please re-enter them in Settings → Tax Studio.');
    }
    return { senderId: row.sa_gateway_sender_id, password, source: 'firm' };
  }

  const envSender = saSenderId(), envPw = saPassword();
  if (envSender && envPw) return { senderId: envSender, password: envPw, source: 'env' };

  return null;
}

/**
 * Full creds incl. the global Vendor ID (firm store → env). Returns null if the
 * Gateway credentials OR the Vendor ID are missing — both are needed to file.
 */
export async function resolveSaCreds(firmId: string): Promise<(SaCreds & { source: 'firm' | 'env' }) | null> {
  const creds = await readGatewayCreds(firmId);
  const vendorId = saVendorId(); // global — SMITH's software id
  if (creds && vendorId) return { senderId: creds.senderId, password: creds.password, vendorId, source: creds.source };
  return null;
}

/** Resolve creds or throw a user-facing error. Use at submission time. */
export async function getSaCredsForFirm(firmId: string): Promise<SaCreds> {
  const resolved = await resolveSaCreds(firmId);
  if (!resolved) throw new SaFilingNotConfiguredError();
  const { senderId, password, vendorId } = resolved;
  return { senderId, password, vendorId };
}

/**
 * Non-throwing status for the settings UI / filing card. Never returns the
 * password. Distinguishes "credentials stored" from "Vendor ID present" so the UI
 * can tell "not entered" apart from "saved but the server Vendor ID is missing".
 */
export async function getSaFilingStatus(firmId: string): Promise<{
  credentialsStored: boolean; senderId: string | null; source: 'firm' | 'env' | null;
  vendorIdConfigured: boolean; ready: boolean;
}> {
  const vendorIdConfigured = !!saVendorId();
  try {
    const creds = await readGatewayCreds(firmId);
    return {
      credentialsStored: !!creds,
      senderId: creds?.senderId ?? null,
      source: creds?.source ?? null,
      vendorIdConfigured,
      ready: !!creds && vendorIdConfigured,
    };
  } catch {
    // Undecryptable stored ciphertext ⇒ effectively unusable; prompt re-entry.
    return { credentialsStored: false, senderId: null, source: null, vendorIdConfigured, ready: false };
  }
}
