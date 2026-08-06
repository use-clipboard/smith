// Tax Studio — cross-module integration contracts (client-safe).
//
// The normalised shapes below are OWNED by Tax Studio; each server-side reader
// (MTD IT, Accounts Studio, …) maps its own model into these. The UI only ever
// sees the normalised shape, so a source changing its internals never touches
// the import components.

import type { Sa100Income } from './types';

export interface MtdSource {
  label: string;
  income: number;
  expenses: number;
  profit: number;
}

export interface MtdItAnnualSummary {
  found: boolean;
  taxYear: string;
  quartersFound: number;
  /** One entry per trade. */
  selfEmployment: MtdSource[];
  ukProperty: MtdSource | null;
  foreignProperty: MtdSource | null;
  /** Optional note surfaced to the user (e.g. "based on 3 of 4 quarters"). */
  note?: string;
}

export type MtdImportSelection = {
  soleTrader: boolean;
  ukProperty: boolean;
  foreignProperty: boolean;
};

/** Fetch a client's aggregated MTD IT figures for a tax year. */
export async function fetchMtdItSummary(clientId: string, taxYear: string): Promise<MtdItAnnualSummary> {
  const qs = new URLSearchParams({ clientId, taxYear });
  const r = await fetch(`/api/tax-studio/integrations/mtd-it?${qs.toString()}`, { cache: 'no-store' });
  if (!r.ok) {
    if (r.status === 404) return { found: false, taxYear, quartersFound: 0, selfEmployment: [], ukProperty: null, foreignProperty: null };
    const d = await r.json().catch(() => ({}));
    throw new Error((d as { error?: string }).error ?? 'Could not read MTD IT figures.');
  }
  return (await r.json()) as MtdItAnnualSummary;
}

// Ids used for MTD-sourced rows, so re-importing REPLACES rather than duplicates.
const SE_PREFIX = 'mtd-se-';
const UK_PREFIX = 'mtd-prop-';
const FOREIGN_PREFIX = 'mtd-fprop-';

/** Merge selected MTD IT figures into an SA100 income, replacing any prior
 *  MTD-sourced rows so re-imports stay idempotent. */
export function mergeMtdIntoIncome(income: Sa100Income, summary: MtdItAnnualSummary, sel: MtdImportSelection): Sa100Income {
  const selfEmployment = income.selfEmployment.filter(s => !s.id.startsWith(SE_PREFIX));
  const property = income.property.filter(p => !p.id.startsWith(UK_PREFIX) && !p.id.startsWith(FOREIGN_PREFIX));

  if (sel.soleTrader) {
    summary.selfEmployment.forEach((t, i) => {
      selfEmployment.push({ id: `${SE_PREFIX}${i}`, name: t.label || `Self-employment ${i + 1}`, profit: Math.round(t.profit) });
    });
  }
  if (sel.ukProperty && summary.ukProperty) {
    property.push({ id: `${UK_PREFIX}0`, address: summary.ukProperty.label || 'UK property (MTD IT)', profit: Math.round(summary.ukProperty.profit) });
  }
  if (sel.foreignProperty && summary.foreignProperty) {
    property.push({ id: `${FOREIGN_PREFIX}0`, address: summary.foreignProperty.label || 'Foreign property (MTD IT)', profit: Math.round(summary.foreignProperty.profit) });
  }
  return { ...income, selfEmployment, property };
}

/** True if the summary carries any importable figure. */
export function summaryHasData(s: MtdItAnnualSummary): boolean {
  return s.found && (s.selfEmployment.length > 0 || !!s.ukProperty || !!s.foreignProperty);
}

// ─── Accounts Studio (final profit → self-employment) ────────────────────────
export interface AccountsStudioSummary {
  found: boolean;
  periodStart: string;   // dd-mm-yyyy
  periodEnd: string;     // dd-mm-yyyy
  entityLabel: string;
  isPartnership: boolean;
  netProfit: number;
  turnover: number;
  note?: string;
}

const AS_PREFIX = 'as-se-';

export async function fetchAccountsStudioSummary(clientId: string, taxYear: string): Promise<AccountsStudioSummary> {
  const qs = new URLSearchParams({ clientId, taxYear });
  const r = await fetch(`/api/tax-studio/integrations/accounts-studio?${qs.toString()}`, { cache: 'no-store' });
  if (!r.ok) {
    if (r.status === 404) return { found: false, periodStart: '', periodEnd: '', entityLabel: '', isPartnership: false, netProfit: 0, turnover: 0 };
    const d = await r.json().catch(() => ({}));
    throw new Error((d as { error?: string }).error ?? 'Could not read Accounts Studio figures.');
  }
  return (await r.json()) as AccountsStudioSummary;
}

/** Merge the Accounts Studio net profit into self-employment as one trade row. */
export function mergeAccountsStudioIntoIncome(income: Sa100Income, s: AccountsStudioSummary): Sa100Income {
  const selfEmployment = income.selfEmployment.filter(x => !x.id.startsWith(AS_PREFIX));
  selfEmployment.push({ id: `${AS_PREFIX}0`, name: 'Trade (Accounts Studio)', profit: Math.round(s.netProfit) });
  return { ...income, selfEmployment };
}

// ─── Landlord Analysis (rental → property) ───────────────────────────────────
export interface LandlordSummary {
  found: boolean;
  dateFrom: string;
  dateTo: string;
  totalIncome: number;
  totalExpenses: number;
  netProfit: number;
  taxableProfit: number;
  financeCosts: number;
  financeReducer: number;
  note?: string;
}

const LL_PREFIX = 'll-analysis-';

export async function fetchLandlordSummary(clientId: string, taxYear: string): Promise<LandlordSummary> {
  const qs = new URLSearchParams({ clientId, taxYear });
  const r = await fetch(`/api/tax-studio/integrations/landlord?${qs.toString()}`, { cache: 'no-store' });
  if (!r.ok) {
    if (r.status === 404) return { found: false, dateFrom: '', dateTo: '', totalIncome: 0, totalExpenses: 0, netProfit: 0, taxableProfit: 0, financeCosts: 0, financeReducer: 0 };
    const d = await r.json().catch(() => ({}));
    throw new Error((d as { error?: string }).error ?? 'Could not read Landlord Analysis figures.');
  }
  return (await r.json()) as LandlordSummary;
}

/** Merge the landlord taxable property profit into property, and carry the
 *  residential finance costs so the SA100 computation applies the 20% reducer. */
export function mergeLandlordIntoIncome(income: Sa100Income, s: LandlordSummary): Sa100Income {
  const property = income.property.filter(p => !p.id.startsWith(LL_PREFIX));
  property.push({ id: `${LL_PREFIX}0`, address: 'UK property (Landlord Analysis)', profit: Math.round(s.taxableProfit) });
  return { ...income, property, financeCosts: Math.round(s.financeCosts) };
}

// ─── Bookkeeping (ledger P&L → self-employment) ──────────────────────────────
export interface BookkeepingSummary {
  found: boolean;
  bookName: string;
  from: string;
  to: string;
  turnover: number;
  totalExpenses: number;
  netProfit: number;
  note?: string;
}

const BK_PREFIX = 'bk-se-';

export async function fetchBookkeepingSummary(clientId: string, taxYear: string): Promise<BookkeepingSummary> {
  const qs = new URLSearchParams({ clientId, taxYear });
  const r = await fetch(`/api/tax-studio/integrations/bookkeeping?${qs.toString()}`, { cache: 'no-store' });
  if (!r.ok) {
    if (r.status === 404) return { found: false, bookName: '', from: '', to: '', turnover: 0, totalExpenses: 0, netProfit: 0 };
    const d = await r.json().catch(() => ({}));
    throw new Error((d as { error?: string }).error ?? 'Could not read Bookkeeping figures.');
  }
  return (await r.json()) as BookkeepingSummary;
}

/** Merge the bookkeeping net profit into self-employment as one trade row. */
export function mergeBookkeepingIntoIncome(income: Sa100Income, s: BookkeepingSummary): Sa100Income {
  const selfEmployment = income.selfEmployment.filter(x => !x.id.startsWith(BK_PREFIX));
  selfEmployment.push({ id: `${BK_PREFIX}0`, name: 'Trade (Bookkeeping)', profit: Math.round(s.netProfit) });
  return { ...income, selfEmployment };
}
