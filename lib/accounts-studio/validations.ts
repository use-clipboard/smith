// Accounts Studio — Stage 5 compliance checks computed from the real engagement.
//
// No template, no simulation: every check is derived from the imported trial
// balance, the built statements, the drafted disclosures and the engagement's
// dates. Re-running just re-derives from current state.

import type { Engagement, ValidationCheck, ValidationStatus } from '@/components/features/accounts-studio/types';
import { checkDisclosures } from './disclosureCheck';

function whole(n: number): string {
  return `£${Math.round(Math.abs(n)).toLocaleString('en-GB')}`;
}

/** dd-mm-yyyy → Date (local midnight). Null if unparseable. */
function parseUk(dmy: string): Date | null {
  const m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(dmy.trim());
  if (!m) return null;
  const d = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
  return isNaN(d.getTime()) ? null : d;
}

const isCompany = (e: string) => e === 'limited_company' || e === 'cic' || e === 'dormant_company';

export function computeValidations(e: Engagement): ValidationCheck[] {
  const checks: ValidationCheck[] = [];
  const push = (id: string, label: string, status: ValidationStatus, detail: string) =>
    checks.push({ id, label, status, detail });

  const s = e.statements;

  // 1. Data imported.
  if (s) push('imported', 'Ledger imported', 'pass', `Trial balance imported${e.importInfo ? ` from ${e.importInfo.bookName}` : ''}.`);
  else push('imported', 'Ledger imported', 'fail', 'No trial balance has been imported — start at Import Data.');

  // 2. Trial balance balances (debits = credits).
  if (e.trialBalance && e.trialBalance.length) {
    const dr = e.trialBalance.reduce((t, r) => t + (r.debit || 0), 0);
    const cr = e.trialBalance.reduce((t, r) => t + (r.credit || 0), 0);
    const diff = Math.abs(dr - cr);
    push('tb-balance', 'Trial balance balances', diff < 0.01 ? 'pass' : 'fail',
      diff < 0.01 ? `Debits and credits agree at ${whole(dr)}.` : `Out of balance by ${whole(diff)} (Dr ${whole(dr)} vs Cr ${whole(cr)}).`);
  }

  // 3. Balance sheet balances (net assets = capital & reserves).
  if (s) {
    const diff = Math.abs(s.balanceSheet.netAssets - s.balanceSheet.totalEquity);
    push('bs-balance', 'Balance sheet balances', diff < 0.01 ? 'pass' : 'warn',
      diff < 0.01
        ? `Net assets ${whole(s.balanceSheet.netAssets)} equal capital & reserves.`
        : `Net assets ${whole(s.balanceSheet.netAssets)} differ from reserves ${whole(s.balanceSheet.totalEquity)} by ${whole(diff)}.`);
  }

  // 4. Comparatives.
  push('comparatives', 'Comparative figures', s?.hasPrior ? 'pass' : 'warn',
    s?.hasPrior ? 'Prior-year comparatives are included.' : 'No prior-year comparatives — first-year accounts or no prior financial year found.');

  // 5. Disclosure completeness (included notes only).
  const includedNotes = e.disclosures.filter(d => d.included !== false);
  const total = includedNotes.length;
  const complete = includedNotes.filter(d => d.status === 'complete').length;
  const outstanding = includedNotes.filter(d => d.status !== 'complete').map(d => d.title);
  push('disclosures', 'Disclosure completeness', complete === total ? 'pass' : 'warn',
    complete === total
      ? `All ${total} disclosures marked complete.`
      : `${complete} of ${total} complete — outstanding: ${outstanding.slice(0, 3).join(', ')}${outstanding.length > 3 ? `, +${outstanding.length - 3} more` : ''}.`);

  // 5b. Disclosure coverage — are the notes the figures call for actually in?
  const gaps = checkDisclosures(e);
  const gapWarns = gaps.filter(g => g.severity === 'warn');
  if (s) {
    push('disclosure-coverage', 'Disclosure coverage', gapWarns.length === 0 ? 'pass' : 'warn',
      gapWarns.length === 0
        ? gaps.length === 0 ? 'All notes required by the figures are included.' : 'Required notes are all included.'
        : `${gapWarns.length} likely missing: ${gapWarns.map(g => g.noteId).slice(0, 3).join(', ')}${gapWarns.length > 3 ? `, +${gapWarns.length - 3} more` : ''}.`);
  }

  // 6. Required primary statement / report present.
  if (isCompany(e.entityType)) {
    const dr = e.disclosures.find(d => d.id === 'directors-report');
    const has = !!dr && !!dr.content.trim();
    push('reports', "Directors' report", has ? 'pass' : 'warn',
      has ? "Directors' report drafted." : "Directors' report has no content yet.");
  } else if (e.entityType === 'llp') {
    const mr = e.disclosures.find(d => d.id === 'members-report');
    const has = !!mr && !!mr.content.trim();
    push('reports', "Members' report", has ? 'pass' : 'warn', has ? "Members' report drafted." : "Members' report has no content yet.");
  }

  // 7. Reporting period.
  push('period', 'Reporting period', e.periodStart && e.periodEnd ? 'pass' : 'fail',
    e.periodStart && e.periodEnd ? `Year ended ${e.periodEnd}.` : 'The reporting period is not set.');

  // 8. Framework.
  push('framework', 'Framework', e.framework ? 'pass' : 'warn',
    e.framework ? `${e.framework} applied.` : 'No reporting framework selected.');

  // 9. Filing deadline.
  const deadline = parseUk(e.chDeadline);
  if (deadline) {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const days = Math.round((deadline.getTime() - today.getTime()) / 86_400_000);
    if (days < 0) push('deadline', 'Filing deadline', 'fail', `Overdue by ${Math.abs(days)} days (was due ${e.chDeadline}).`);
    else if (days <= 30) push('deadline', 'Filing deadline', 'warn', `Due in ${days} days (${e.chDeadline}).`);
    else push('deadline', 'Filing deadline', 'pass', `${days} days remaining (due ${e.chDeadline}).`);
  }

  return checks;
}
