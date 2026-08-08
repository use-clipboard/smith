// Tax Studio — cross-module integration contracts (client-safe).
//
// The normalised shapes below are OWNED by Tax Studio; each server-side reader
// (MTD IT, Accounts Studio, …) maps its own model into these. The UI only ever
// sees the normalised shape, so a source changing its internals never touches
// the import components.

import type { Sa100Income, TradeSource, PartnershipSource } from './types';
import { SA103_SHORT_TURNOVER_LIMIT, migrateTradeToShort } from './tradeForm';

/** One line of a source P&L (an income or expense account/statement line). */
export interface PlLine { label: string; amount: number; section: 'income' | 'expense'; }

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
  /** Line-level P&L for itemising into SA103F boxes (when available). */
  lines?: PlLine[];
  note?: string;
}

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
  /** The client owns a property jointly (additional owners or ownership < 100%) —
   *  used to smart-guess the SA105 "let jointly" box (box 3). */
  jointlyOwned?: boolean;
  note?: string;
}

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

// ─── Bookkeeping (ledger P&L → self-employment) ──────────────────────────────
export interface BookkeepingSummary {
  found: boolean;
  bookName: string;
  from: string;
  to: string;
  turnover: number;
  totalExpenses: number;
  netProfit: number;
  /** Line-level P&L for itemising into SA103F boxes (when available). */
  lines?: PlLine[];
  note?: string;
}

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

// ─── Cross-client imports ────────────────────────────────────────────────────
// Pull a saved analysis from ANOTHER client's history — e.g. a rental portfolio
// held under a dedicated rental client code that doesn't match the SA100 client.
//
// Cross-client rows live in their own id namespace (`xc-…-<sourceClientId>-`) so
// they never collide with the return's own imports and stay idempotent per
// source: re-importing the same client's analysis replaces only its own rows.
// The source client is stamped onto each row label for traceability.

const XC = 'xc-';

export interface SourceRef {
  clientId: string;
  /** Human label stamped onto imported rows, e.g. "Smith Rentals (RENT001)". */
  label: string;
}

/** Cross-client Landlord Analysis → UK property. When the Landlord tool flags the
 *  property as jointly owned, smart-guess the SA105 "let jointly" box (box 3). */
export function mergeCrossLandlord(income: Sa100Income, s: LandlordSummary, src: SourceRef): Sa100Income {
  const pfx = `${XC}ll-${src.clientId}-`;
  const property = income.property.filter(p => !p.id.startsWith(pfx));
  property.push({ id: `${pfx}0`, address: `UK property — ${src.label}`, profit: Math.round(s.taxableProfit), residentialFinanceCosts: Math.round(s.financeCosts) });
  return { ...income, property, propertyLetJointly: s.jointlyOwned ? true : income.propertyLetJointly };
}

/** Cross-client MTD IT → self-employment / UK & foreign property. */
export function mergeCrossMtd(income: Sa100Income, summary: MtdItAnnualSummary, sel: MtdImportSelection, src: SourceRef): Sa100Income {
  const sePfx = `${XC}mtd-se-${src.clientId}-`;
  const ukPfx = `${XC}mtd-uk-${src.clientId}-`;
  const fpPfx = `${XC}mtd-fp-${src.clientId}-`;
  const selfEmployment = income.selfEmployment.filter(x => !x.id.startsWith(sePfx));
  const property = income.property.filter(p => !p.id.startsWith(ukPfx) && !p.id.startsWith(fpPfx));
  if (sel.soleTrader) {
    summary.selfEmployment.forEach((t, i) => selfEmployment.push({ id: `${sePfx}${i}`, name: `${t.label || `Self-employment ${i + 1}`} — ${src.label}`, profit: Math.round(t.profit) }));
  }
  if (sel.ukProperty && summary.ukProperty) {
    property.push({ id: `${ukPfx}0`, address: `UK property — ${src.label}`, profit: Math.round(summary.ukProperty.profit) });
  }
  if (sel.foreignProperty && summary.foreignProperty) {
    property.push({ id: `${fpPfx}0`, address: `Foreign property — ${src.label}`, profit: Math.round(summary.foreignProperty.profit) });
  }
  return { ...income, selfEmployment, property };
}

/** Cross-client Accounts Studio net profit → self-employment. */
export function mergeCrossAccounts(income: Sa100Income, s: AccountsStudioSummary, src: SourceRef): Sa100Income {
  const pfx = `${XC}as-${src.clientId}-`;
  const selfEmployment = income.selfEmployment.filter(x => !x.id.startsWith(pfx));
  selfEmployment.push({ id: `${pfx}0`, name: `Trade — ${src.label}`, profit: Math.round(s.netProfit) });
  return { ...income, selfEmployment };
}

/** Cross-client Bookkeeping net profit → self-employment. */
export function mergeCrossBookkeeping(income: Sa100Income, s: BookkeepingSummary, src: SourceRef): Sa100Income {
  const pfx = `${XC}bk-${src.clientId}-`;
  const selfEmployment = income.selfEmployment.filter(x => !x.id.startsWith(pfx));
  selfEmployment.push({ id: `${pfx}0`, name: `Trade — ${src.label}`, profit: Math.round(s.netProfit) });
  return { ...income, selfEmployment };
}

// ─── Itemised trade import (P&L lines → SA103F boxes 15–30) ───────────────────
// The AI maps each source P&L line to an SA103F box; the user reviews/edits the
// allocation before it lands. Falls back to the single net-profit path when a
// source has no line detail.

/** An SA103F income/expense box that a P&L line can be allocated to. `disField`
 *  is the matching disallowable box (32–45) for an expense box (17–30). */
export interface Sa103Box { box: string; field: keyof TradeSource; label: string; section: 'income' | 'expense'; disField?: keyof TradeSource; }

/** SA103F turnover / other income (15–16) and allowable expense boxes (17–30),
 *  each expense box carrying its disallowable counterpart (32–45). */
export const SA103_BOX_CATALOG: Sa103Box[] = [
  { box: '15', field: 'turnover', label: 'Turnover', section: 'income' },
  { box: '16', field: 'otherBusinessIncome', label: 'Any other business income', section: 'income' },
  { box: '17', field: 'expCostOfGoods', label: 'Cost of goods bought for resale', section: 'expense', disField: 'disCostOfGoods' },
  { box: '18', field: 'expSubcontractors', label: 'Construction industry subcontractors', section: 'expense', disField: 'disSubcontractors' },
  { box: '19', field: 'expWages', label: 'Wages, salaries and other staff costs', section: 'expense', disField: 'disWages' },
  { box: '20', field: 'expCarVanTravel', label: 'Car, van and travel expenses', section: 'expense', disField: 'disCarVanTravel' },
  { box: '21', field: 'expPremises', label: 'Rent, rates, power and insurance', section: 'expense', disField: 'disPremises' },
  { box: '22', field: 'expRepairs', label: 'Repairs and renewals', section: 'expense', disField: 'disRepairs' },
  { box: '23', field: 'expOffice', label: 'Phone, fax, stationery and office costs', section: 'expense', disField: 'disOffice' },
  { box: '24', field: 'expAdvertising', label: 'Advertising and business entertainment', section: 'expense', disField: 'disAdvertising' },
  { box: '25', field: 'expInterest', label: 'Interest on bank and other loans', section: 'expense', disField: 'disInterest' },
  { box: '26', field: 'expBankCharges', label: 'Bank, credit card and financial charges', section: 'expense', disField: 'disBankCharges' },
  { box: '27', field: 'expBadDebts', label: 'Irrecoverable debts written off', section: 'expense', disField: 'disBadDebts' },
  { box: '28', field: 'expProfessional', label: 'Accountancy, legal and professional fees', section: 'expense', disField: 'disProfessional' },
  { box: '29', field: 'expDepreciation', label: 'Depreciation and loss on sale of assets', section: 'expense', disField: 'disDepreciation' },
  { box: '30', field: 'expOtherCosts', label: 'Other business expenses', section: 'expense', disField: 'disOtherCosts' },
];

/** One reviewed allocation of a source P&L line to an SA103F box, with the
 *  portion the AI judged disallowable for tax (added back in boxes 32–45). */
export interface BoxAllocation { label: string; amount: number; box: string; disallowable: number; }

/** dd-mm-yyyy → yyyy-mm-dd (for HTML date inputs); passes through an ISO date. */
export function dmyToIso(s?: string): string | undefined {
  if (!s) return undefined;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.trim().match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : undefined;
}

/** The accounting period a source covers, as ISO dates (for boxes 8/9 or 7). */
export interface TradePeriod { start?: string; end?: string; }

/** Ask the server to map source P&L lines to SA103F boxes (AI). Falls back to a
 *  turnover/other-costs split on any failure so the import still proceeds. */
export async function fetchTradeBoxMapping(lines: PlLine[]): Promise<BoxAllocation[]> {
  const fallback = (): BoxAllocation[] => lines.map(l => ({ label: l.label, amount: Math.round(l.amount), box: l.section === 'income' ? '15' : '30', disallowable: 0 }));
  try {
    const r = await fetch('/api/tax-studio/integrations/map-trade-boxes', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lines }),
    });
    if (!r.ok) return fallback();
    const d = await r.json().catch(() => null) as { allocations?: BoxAllocation[] } | null;
    const valid = new Set(SA103_BOX_CATALOG.map(b => b.box));
    const out = (d?.allocations ?? []).filter(a => a && valid.has(a.box)).map(a => {
      const amount = Math.round(Number(a.amount) || 0);
      const dis = Math.min(amount, Math.max(0, Math.round(Number(a.disallowable) || 0)));
      return { label: String(a.label ?? ''), amount, box: a.box, disallowable: dis };
    });
    return out.length ? out : fallback();
  } catch { return fallback(); }
}

/** Build an itemised trade from reviewed box allocations — fills the income /
 *  expense boxes (15–30) and the disallowable portions (32–45). Picks the full
 *  or short form by turnover: at/above the VAT threshold it stays full; below it
 *  is folded to the short form (allowable-only, combined boxes). */
export function buildItemisedTrade(id: string, name: string, allocations: BoxAllocation[], period?: TradePeriod): TradeSource {
  const trade: TradeSource = { id, name, profit: 0, form: 'full' };
  if (period?.start) trade.periodStart = period.start;
  if (period?.end) trade.periodEnd = period.end;
  const nums = trade as unknown as Record<string, number>;
  const byBox = new Map(SA103_BOX_CATALOG.map(b => [b.box, b]));
  let turnover = 0;
  for (const a of allocations) {
    const cat = byBox.get(a.box);
    if (!cat) continue;
    if (cat.section === 'income') turnover += Math.round(a.amount);
    nums[cat.field as string] = (nums[cat.field as string] || 0) + Math.round(a.amount);
    if (cat.disField && a.disallowable > 0) {
      nums[cat.disField as string] = (nums[cat.disField as string] || 0) + Math.round(a.disallowable);
    }
  }
  return turnover >= SA103_SHORT_TURNOVER_LIMIT ? trade : migrateTradeToShort(trade);
}

/** Merge an itemised trade under a source prefix (idempotent per source). */
export function mergeItemisedTrade(income: Sa100Income, trade: TradeSource, src: SourceRef, kind: 'as' | 'bk'): Sa100Income {
  const pfx = `${XC}${kind}-${src.clientId}-`;
  const selfEmployment = income.selfEmployment.filter(x => !x.id.startsWith(pfx));
  selfEmployment.push({ ...trade, id: `${pfx}0` });
  return { ...income, selfEmployment };
}

// ─── Uploaded accounts / trial balance → itemised trade ──────────────────────
/** An encoded upload (PDF/image as base64, CSV/text as text) — matches the
 *  extract routes' file shape. */
export interface UploadFile { name: string; mimeType: string; base64?: string; text?: string; }

/** Read an uploaded set of accounts / trial balance into P&L lines + the
 *  accounting period (AI). These flow into the same itemise-and-review modal. */
export async function fetchTradePlFromFiles(files: UploadFile[]): Promise<{ lines: PlLine[]; period: TradePeriod }> {
  const r = await fetch('/api/tax-studio/integrations/extract-trade-pl', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ files }),
  });
  if (!r.ok) {
    const d = await r.json().catch(() => ({}));
    throw new Error((d as { error?: string }).error ?? 'Could not read the accounts.');
  }
  const d = await r.json() as { lines?: PlLine[]; periodStart?: string; periodEnd?: string };
  return {
    lines: (d.lines ?? []).filter(l => l && l.label && l.amount),
    period: { start: dmyToIso(d.periodStart), end: dmyToIso(d.periodEnd) },
  };
}

// ─── Partnership (SA104) imports ─────────────────────────────────────────────
// Unlike a sole trade, SA104 records the partner's SHARE of a figure the
// partnership already computed (on its SA800) — there are no expense boxes to
// itemise. So a partnership import is just: net profit × the partner's share
// → box 8. Each source client contributes at most one partnership (idempotent,
// so re-reading updates it); uploads always append, so a client with several
// partnerships is handled by linking each partnership's client or uploading each
// set of accounts.

/** Net profit implied by a set of P&L lines (income − expenses). */
export function netFromPlLines(lines: PlLine[]): number {
  return lines.reduce((a, l) => a + (l.section === 'income' ? l.amount : -l.amount), 0);
}

/** Build a partnership source from a single net-profit figure and the partner's
 *  profit share (%). Defaults to the short SA104S form (trade profit only). */
export function buildPartnershipFromNet(id: string, name: string, netProfit: number, sharePct: number, period?: TradePeriod): PartnershipSource {
  const share = Math.max(0, Math.min(100, sharePct || 0));
  const p: PartnershipSource = { id, name, form: 'short', profit: Math.round(netProfit * share / 100) };
  if (period?.start) p.periodStart = period.start;
  if (period?.end) p.periodEnd = period.end;
  return p;
}

/** Merge a connected-tool partnership import (idempotent per source client, so
 *  pulling from a second partnership client adds a second partnership row). */
export function mergeImportedPartnership(income: Sa100Income, partnership: PartnershipSource, src: SourceRef, kind: 'as' | 'bk'): Sa100Income {
  const pfx = `${XC}p${kind}-${src.clientId}-`;
  const partnerships = (income.partnerships ?? []).filter(x => !x.id.startsWith(pfx));
  partnerships.push({ ...partnership, id: `${pfx}0` });
  return { ...income, partnerships };
}

/** Append an uploaded-accounts partnership (each upload is a new partnership). */
export function appendUploadedPartnership(income: Sa100Income, partnership: PartnershipSource): Sa100Income {
  return { ...income, partnerships: [...(income.partnerships ?? []), partnership] };
}
