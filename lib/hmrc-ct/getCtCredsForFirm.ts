// Server-side only — resolve a firm's HMRC CT600 (GovTalk) filing credentials.
// Prefers the firm's own stored credentials (Settings → Tax Studio), falling back
// to env vars (single-firm internal pilot). Mirrors lib/hmrc-sa/getSaCredsForFirm.
//
// The Vendor ID is global (SMITH's CT software id) and always comes from env —
// only the SenderID + password are per-firm. The password is AES-256-GCM
// encrypted (lib/crypto/secretBox.ts) and decrypted here at submission time.

import { createServiceClient } from '@/lib/supabase-server';
import { decryptSecret } from '@/lib/crypto/secretBox';
import { ctSenderId, ctPassword, ctVendorId, type CtCreds } from './config';

/** Thrown when CT online filing has no usable credentials for the firm. */
export class CtFilingNotConfiguredError extends Error {
  constructor(msg?: string) {
    super(msg || 'CT600 online filing is not set up. Ask your admin to add your HMRC Government Gateway credentials in Settings → Tax Studio.');
    this.name = 'CtFilingNotConfiguredError';
  }
}

interface FirmCtRow { ct_gateway_sender_id: string | null; ct_gateway_password_enc: string | null }

/**
 * Gateway credentials only (SenderID + password), firm store → env fallback,
 * INDEPENDENT of the global Vendor ID. Returns null if none are stored.
 * Throws CtFilingNotConfiguredError only if firm-stored ciphertext won't decrypt.
 */
async function readGatewayCreds(firmId: string): Promise<{ senderId: string; password: string; source: 'firm' | 'env' } | null> {
  const service = createServiceClient();
  const { data } = await service
    .from('firms').select('ct_gateway_sender_id, ct_gateway_password_enc').eq('id', firmId).single();
  const row = (data ?? null) as FirmCtRow | null;

  if (row?.ct_gateway_sender_id && row?.ct_gateway_password_enc) {
    let password: string;
    try {
      password = decryptSecret(row.ct_gateway_password_enc);
    } catch {
      throw new CtFilingNotConfiguredError('Your stored HMRC credentials could not be decrypted (the server encryption key is missing or has changed). Please re-enter them in Settings → Tax Studio.');
    }
    return { senderId: row.ct_gateway_sender_id, password, source: 'firm' };
  }

  const envSender = ctSenderId(), envPw = ctPassword();
  if (envSender && envPw) return { senderId: envSender, password: envPw, source: 'env' };

  return null;
}

/**
 * Full creds incl. the global Vendor ID (firm store → env). Returns null if the
 * Gateway credentials OR the Vendor ID are missing — both are needed to file.
 */
export async function resolveCtCreds(firmId: string): Promise<(CtCreds & { source: 'firm' | 'env' }) | null> {
  const creds = await readGatewayCreds(firmId);
  const vendorId = ctVendorId(); // global — SMITH's CT software id
  if (creds && vendorId) return { senderId: creds.senderId, password: creds.password, vendorId, source: creds.source };
  return null;
}

/** Resolve creds or throw a user-facing error. Use at submission time. */
export async function getCtCredsForFirm(firmId: string): Promise<CtCreds> {
  const resolved = await resolveCtCreds(firmId);
  if (!resolved) throw new CtFilingNotConfiguredError();
  const { senderId, password, vendorId } = resolved;
  return { senderId, password, vendorId };
}

/**
 * Non-throwing status for the settings UI / filing card. Never returns the
 * password. Distinguishes "credentials stored" from "Vendor ID present".
 */
export async function getCtFilingStatus(firmId: string): Promise<{
  credentialsStored: boolean; senderId: string | null; source: 'firm' | 'env' | null;
  vendorIdConfigured: boolean; ready: boolean;
}> {
  const vendorIdConfigured = !!ctVendorId();
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
    return { credentialsStored: false, senderId: null, source: null, vendorIdConfigured, ready: false };
  }
}
