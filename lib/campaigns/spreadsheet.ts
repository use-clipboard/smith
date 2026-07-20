// Spreadsheet mail-merge helpers — pure, client + server safe.
//
// A spreadsheet audience stores its own columns + rows (a CSV/Excel upload) on
// the campaign_audiences.definition. Each row is a distinct recipient even when
// several rows share an email address — which is exactly the shared-address case
// Gmail's own mail-merge can't handle. Mapped columns fill the standard campaign
// merge tags; any other column becomes a {{custom.<key>}} tag.

import type { SpreadsheetColumn, SpreadsheetColumnRole } from '@/types/campaigns';

/** Slug for a column: lowercase letters + underscores only (the merge-tag regex
 *  in mergeFields.ts allows no digits), non-empty, unique within the sheet. */
export function slugifyKey(header: string, taken: Set<string>): string {
  let base = (header || '').toLowerCase().replace(/[^a-z]+/g, '_').replace(/^_+|_+$/g, '');
  if (!base) base = 'field';
  let key = base;
  let suffix = 1;
  while (taken.has(key)) { suffix++; key = `${base}_${'abcdefghijklmnop'[suffix - 2] ?? suffix}`; }
  taken.add(key);
  return key;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export function isValidEmail(s: string): boolean {
  return EMAIL_RE.test((s || '').trim());
}

/** Guess a column's role from its header and a few sample values. */
export function detectRole(header: string, samples: string[]): SpreadsheetColumnRole {
  const h = (header || '').toLowerCase();
  const looksEmail = samples.filter(Boolean).slice(0, 20);
  const emailish = looksEmail.length > 0 && looksEmail.filter(v => v.includes('@')).length >= Math.ceil(looksEmail.length / 2);
  if (h.includes('email') || h.includes('e-mail') || emailish) return 'email';
  if (h.includes('first') && h.includes('name')) return 'first_name';
  if (h.includes('business') || h.includes('company') || h.includes('trading') || h.includes('organisation') || h.includes('organization')) return 'business_name';
  if (h.includes('ref') || h === 'code' || h.includes('client code') || h.includes('client ref')) return 'reference';
  if (h.includes('name') || h.includes('contact')) return 'full_name';
  return 'custom';
}

export interface RowRecipient {
  email: string;
  name: string;
  first_name: string;
  business_name: string;
  reference: string;
  custom: Record<string, string>;   // keyed by column key
}

/** Extract the recipient fields from one row given the column mapping. */
export function rowToRecipient(columns: SpreadsheetColumn[], row: Record<string, string>): RowRecipient {
  const byRole = (role: SpreadsheetColumnRole): string => {
    const col = columns.find(c => c.role === role);
    return col ? (row[col.key] ?? '').trim() : '';
  };
  const custom: Record<string, string> = {};
  for (const c of columns) {
    if (c.role === 'custom') custom[c.key] = (row[c.key] ?? '').trim();
  }
  const first = byRole('first_name');
  const full = byRole('full_name');
  return {
    email: byRole('email'),
    name: full || first || byRole('business_name'),
    first_name: first || (full ? full.split(/\s+/)[0] : ''),
    business_name: byRole('business_name'),
    reference: byRole('reference'),
    custom,
  };
}

/** Merge-tag map for a spreadsheet recipient — standard client.* tags plus a
 *  {{custom.<key>}} entry per unmapped column. */
export function rowMergeData(r: RowRecipient): Record<string, string> {
  const data: Record<string, string> = {
    'client.first_name': r.first_name,
    'client.full_name': r.name,
    'client.business_name': r.business_name || r.name,
    'client.reference': r.reference,
  };
  for (const [k, v] of Object.entries(r.custom)) data[`custom.${k}`] = v;
  return data;
}

/** The {{custom.<key>}} tags a spreadsheet exposes, for showing in the UI. */
export function customTagsFor(columns: SpreadsheetColumn[]): string[] {
  return columns.filter(c => c.role === 'custom').map(c => `{{custom.${c.key}}}`);
}
