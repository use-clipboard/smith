// Accounts Studio — rules-based "is a needed note missing?" check.
//
// Deterministic first pass (reliable), surfaced in the Disclosures stage and
// Final Review. The AI "review my disclosures" action is a second opinion on top.

import type { Engagement } from '@/components/features/accounts-studio/types';

export interface DisclosureWarning {
  id: string;
  severity: 'warn' | 'info';
  message: string;
  /** The note that resolves it (to offer a one-click include/add). */
  noteId: string;
}

const COMPANY = ['limited_company', 'cic', 'dormant_company'];
const material = (n: number | null | undefined) => n != null && Math.abs(n) >= 1;

/** Flag notes that should be included given the figures + entity, but aren't. */
export function checkDisclosures(e: Engagement): DisclosureWarning[] {
  const out: DisclosureWarning[] = [];
  const micro = e.size === 'micro';
  const isCompany = COMPANY.includes(e.entityType);
  const bs = e.statements?.balanceSheet;

  // A note counts as present when it's in the set and included (content may
  // still be a draft — emptiness is handled by the completeness check).
  const active = (id: string) => e.disclosures.some(d => d.id === id && d.included !== false);
  const excluded = (id: string) => e.disclosures.some(d => d.id === id && d.included === false);
  const req = (cond: boolean, id: string, message: string) => { if (cond && !active(id)) out.push({ id, severity: 'warn', message, noteId: id }); };
  const rec = (cond: boolean, id: string, message: string) => { if (cond && !active(id)) out.push({ id, severity: 'info', message, noteId: id }); };

  req(true, 'policies', excluded('policies') ? 'The accounting policies note has been excluded but is required.' : 'The accounting policies / basis-of-preparation note is required.');

  if (bs && !micro) {
    req(material(bs.fixedAssetsTotal), 'fixed-assets', 'There are fixed assets on the balance sheet but no fixed-assets note is included.');
    req(material(bs.currentAssetsTotal), 'debtors', 'There are current assets (debtors) but no debtors note is included.');
    req(material(bs.creditorsWithinTotal) || material(bs.creditorsAfterTotal), 'creditors', 'There are creditors but no creditors note is included.');
    req(isCompany && material(bs.capitalTotal), 'share-capital', 'There is share capital but no share-capital note is included.');

    // Related parties — flag when a director balance is present in the ledger.
    const dir = [...bs.creditorsWithin, ...bs.creditorsAfter, ...bs.currentAssets]
      .some(g => `${g.title} ${g.lines.map(l => l.label).join(' ')}`.toLowerCase().includes('director'));
    req(dir, 'related-parties', "There's a director's balance in the ledger but no related-party note is included.");
  }

  req(isCompany && !micro, 'directors-report', "A directors' report is required for a company but isn't included.");
  rec(!micro, 'going-concern', 'Consider including a going concern note.');
  rec(!micro, 'events', 'Consider a note on events after the reporting date.');

  return out;
}
