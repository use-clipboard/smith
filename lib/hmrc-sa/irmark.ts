// HMRC IRmark — message-integrity hash for GovTalk submissions.
//
// Algorithm, verbatim from HMRC "IRmark Generation Step By Step Guide" v2.0
// (19/07/2011), for Gateway-Protocol services:
//   1. Take the <Body> node (inclusive of its tags), INHERITING every namespace
//      declared on <GovTalkMessage> onto <Body>. (This namespace is present only
//      for the calculation — NOT on the actual submission.)
//   2. Remove the <IRmark> element (preserving any whitespace around it — our
//      generator emits none, so removal is clean).
//   3. Canonicalise with W3C inclusive Canonical XML 1.0, no comments
//      (http://www.w3.org/TR/2001/REC-xml-c14n-20010315).
//   4. SHA-1 → 20 raw bytes.
//   5. Base64 → goes in the transmitted <IRmark>; Base32 → human-readable receipt.
//
// We use xml-crypto's `C14nCanonicalization` for step 3 (HMRC: "do not write
// your own" c14n) — its getAlgorithmName() is exactly the URI above. Server-side
// only.

import { createHash } from 'crypto';
import { DOMParser } from '@xmldom/xmldom';
import { C14nCanonicalization } from 'xml-crypto';

const ENVELOPE_NS = 'http://www.govtalk.gov.uk/CM/envelope';
const IRMARK_SLOT = '<IRmark Type="generic"></IRmark>';

/** RFC 4648 Base32 of the 20-byte digest (exactly 32 chars — the receipt form). */
function base32(buf: Buffer): string {
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0, val = 0, out = '';
  for (const byte of buf) {
    val = (val << 8) | byte; bits += 8;
    while (bits >= 5) { out += A[(val >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += A[(val << (5 - bits)) & 31];
  return out;
}

export interface IrmarkResult {
  /** Base64 SHA-1 digest — the value transmitted in the <IRmark> element. */
  base64: string;
  /** Base32 SHA-1 digest — the human-readable receipt form. */
  base32: string;
  /** The exact canonical bytes that were hashed (kept for debugging/TPVS). */
  canonical: string;
}

/**
 * Compute the IRmark from a `<Body>` XML string that already carries the
 * GovTalkMessage namespace on the <Body> element (the caller adds it — see
 * markIrEnvelope). Removes the <IRmark> element, canonicalises, SHA-1s, encodes.
 */
export function computeIrmark(bodyXmlWithNs: string): IrmarkResult {
  const doc = new DOMParser().parseFromString(bodyXmlWithNs, 'text/xml');
  const body = doc.documentElement;
  if (!body) throw new Error('IRmark: could not parse <Body>.');
  const marks = body.getElementsByTagName('IRmark');
  for (let i = marks.length - 1; i >= 0; i--) marks[i].parentNode?.removeChild(marks[i]);
  // xml-crypto walks the xmldom node structurally; the DOM lib types differ so cast.
  const canonical = new C14nCanonicalization().process(body as unknown as Node, { ancestorNamespaces: [] });
  const digest = createHash('sha1').update(Buffer.from(canonical, 'utf8')).digest();
  return { base64: digest.toString('base64'), base32: base32(digest), canonical };
}

/**
 * SA100 convenience: given the `<IRenvelope>` (with an empty IRmark slot from
 * sa100Return.ts), compute the mark and return the submission-ready `<Body>`
 * with the IRmark filled in — the submission Body does NOT carry the inherited
 * namespace (that is only used for the calculation).
 */
export function markIrEnvelope(irEnvelope: string): { base64: string; base32: string; body: string } {
  if (!irEnvelope.includes(IRMARK_SLOT)) {
    throw new Error('IRmark: the IRenvelope is missing the empty <IRmark Type="generic"></IRmark> slot.');
  }
  // For the CALC, wrap in a <Body> carrying the GovTalk envelope namespace.
  const { base64, base32: b32 } = computeIrmark(`<Body xmlns="${ENVELOPE_NS}">${irEnvelope}</Body>`);
  // For SUBMISSION: plain <Body>, IRmark filled in.
  const filled = irEnvelope.replace(IRMARK_SLOT, `<IRmark Type="generic">${base64}</IRmark>`);
  return { base64, base32: b32, body: `<Body>${filled}</Body>` };
}
