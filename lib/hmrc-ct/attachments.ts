// CT600 <AttachedFiles> — embed the computation + accounts iXBRL (Phase C).
//
// A CT600 online submission carries TWO inline-XBRL documents inside the return:
// the tax computation (lib/hmrc-ct/computationIxbrl.ts) and the statutory
// accounts (lib/accounts-studio/ixbrl.ts, via ./accountsIxbrl). Each is embedded
// base64-encoded in an <EncodedInlineXBRLDocument> element.
//
// ⚠ The <AttachedFiles> / <XBRLsubmission> element structure is PROVISIONAL —
// it follows HMRC's documented CT attachment shape but is not yet validated
// against the CT600 schema pack. Isolated here so a correction lands in one place.

import { group } from './xml';

/** Base64-encode a UTF-8 string (server-side). */
function encodeDocument(doc: string): string {
  return Buffer.from(doc, 'utf8').toString('base64');
}

/** One embedded iXBRL instance. */
function instance(doc: string): string {
  return group('Instance', [
    `<EncodedInlineXBRLDocument>${encodeDocument(doc)}</EncodedInlineXBRLDocument>`,
  ]);
}

export interface Ct600Attachments {
  /** The tax-computation iXBRL (buildCt600ComputationIxbrl). */
  computationIxbrl?: string | null;
  /** The statutory-accounts iXBRL (buildIxbrlFromEngagement). */
  accountsIxbrl?: string | null;
}

/**
 * Build the <AttachedFiles> block, or '' when neither document is present.
 * HMRC requires both the computation and the accounts on a full CT600; a caller
 * should only omit one deliberately (e.g. accounts filed separately with CH).
 */
export function buildAttachedFiles(att: Ct600Attachments): string {
  const xbrl = group('XBRLsubmission', [
    att.computationIxbrl ? group('Computation', [instance(att.computationIxbrl)]) : '',
    att.accountsIxbrl ? group('Accounts', [instance(att.accountsIxbrl)]) : '',
  ]);
  return group('AttachedFiles', [xbrl]);
}
