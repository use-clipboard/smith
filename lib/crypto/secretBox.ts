// Server-side only — app-layer symmetric encryption for secrets at rest.
//
// AES-256-GCM (authenticated encryption) for reusable primary credentials that
// must be decryptable — currently the firm's HMRC Government Gateway password for
// legacy SA100 filing (see lib/hmrc-sa/getSaCredsForFirm.ts).
//
// Key: env var SA_CRED_ENCRYPTION_KEY = a base64-encoded 32-byte key. Generate
// with `openssl rand -base64 32`. Never commit it; set it in the environment
// (Vercel + .env.local). Rotating the key makes existing ciphertext undecryptable
// (callers treat that as "not configured" and prompt for re-entry).
//
// Payload format (all parts base64): "v1.<iv>.<authTag>.<ciphertext>".

import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const VERSION = 'v1';
const ALGO = 'aes-256-gcm';
const IV_BYTES = 12; // 96-bit nonce, the GCM standard

function getKey(): Buffer {
  const raw = (process.env.SA_CRED_ENCRYPTION_KEY || '').trim();
  if (!raw) throw new Error('SA_CRED_ENCRYPTION_KEY is not set — cannot encrypt/decrypt stored credentials.');
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) throw new Error('SA_CRED_ENCRYPTION_KEY must be a base64-encoded 32-byte key (e.g. `openssl rand -base64 32`).');
  return key;
}

/** True when a valid encryption key is configured (no throw). */
export function isSecretBoxConfigured(): boolean {
  try { getKey(); return true; } catch { return false; }
}

/** Encrypt a UTF-8 string → "v1.<iv>.<tag>.<ct>" (all base64). */
export function encryptSecret(plaintext: string): string {
  const key = getKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString('base64'), tag.toString('base64'), ct.toString('base64')].join('.');
}

/** Decrypt a payload produced by encryptSecret. Throws if tampered / wrong key / malformed. */
export function decryptSecret(payload: string): string {
  const key = getKey();
  const parts = (payload || '').split('.');
  if (parts.length !== 4 || parts[0] !== VERSION) throw new Error('Malformed encrypted payload.');
  const iv = Buffer.from(parts[1], 'base64');
  const tag = Buffer.from(parts[2], 'base64');
  const ct = Buffer.from(parts[3], 'base64');
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
}
