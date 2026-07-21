// Build P&L data for the review-phase "P&L View" modal.
//
// Rules:
// • Flagged entries are excluded (same as the editor's headline totals).
// • Foreign-rental amounts are converted to GBP using each row's fx_rate,
//   falling back to the quarter-level fxRates map. Rows without any usable
//   rate contribute 0 to the GBP total (and surface in `unconverted`).
// • Amounts are the client's SHARE of each row (share_pct), not the whole
//   invoice — see lib/mtdIt/amounts.ts. computeUpdate applies the same rule,
//   so the P&L and the figures filed with HMRC agree.
// • Breakdown by trade (sole) or property (rental) — rows without a
//   trade/property go into an "Unallocated" bucket. If every row is
//   unallocated, the breakdown is suppressed (caller can show just the
//   stream-level P&L).

import { round2, shareAdjustedGbp } from './amounts';
import { isEntryFlagged } from './flags';
import { isResidentialFinanceCost, RESIDENTIAL_FINANCE_REDUCER_RATE } from './financeCosts';
import type { EditorEntry } from './types';
import type { MtdItStream, MtdItProperty, MtdItTrade } from '@/types';

export interface PnLLine     { category: string; amount: number; }
export interface PnLSection  { title: string;    lines: PnLLine[]; total: number; }
export interface PnLBucket {
  /** The trade name, property address, or 'Unallocated'. */
  label: string;
  /** Optional sub-label (e.g. country for foreign property). */
  sublabel?: string | null;
  unallocated: boolean;
  income: PnLSection;
  /** DEDUCTIBLE expenses only — residential finance costs are held out (below). */
  expense: PnLSection;
  /** Restricted residential finance costs (relieved as a 20% tax reducer, NOT
   *  deducted). Excluded from `expense` and from `net`. */
  residentialFinanceCost: number;
  net: number;
  /** Number of rows that fell into this bucket. */
  rowCount: number;
}
export interface PnLForStream {
  stream: MtdItStream;
  streamLabel: string;
  /** Aggregated income section across the whole stream. */
  income: PnLSection;
  /** Aggregated DEDUCTIBLE expense section across the whole stream. */
  expense: PnLSection;
  /** Restricted residential finance costs for the whole stream — reported
   *  separately, relieved as a 20% tax reducer, and NOT subtracted from `net`. */
  residentialFinanceCost: number;
  /** Indicative basic-rate (20%) tax reducer on the residential finance cost.
   *  For display only — HMRC does the real, capped calculation at Final Declaration. */
  residentialFinanceReducer: number;
  net: number;
  rowCount: number;
  /** Per-trade or per-property breakdown. Empty if every row is unallocated. */
  breakdown: PnLBucket[];
  /** Rows that have a non-GBP currency but no usable fx_rate. */
  unconvertedCount: number;
}

const STREAM_LABEL: Record<MtdItStream, string> = {
  sole:           'Sole Trader',
  uk_rental:      'UK Rental',
  foreign_rental: 'Foreign Rental',
};

function emptySection(title: string): PnLSection { return { title, lines: [], total: 0 }; }

function buildSection(title: string, entries: EditorEntry[], fxRates: Record<string, number>): PnLSection {
  const byCategory = new Map<string, number>();
  for (const e of entries) {
    // Round per row, not at the end: a partial share_pct puts a long tail on
    // every row, and computeUpdate (the filing path) rounds per row too. Summing
    // raw here would drift the P&L away from the figures actually filed.
    const v = round2(shareAdjustedGbp(e, fxRates));
    byCategory.set(e.category, (byCategory.get(e.category) ?? 0) + v);
  }
  const lines = Array.from(byCategory.entries())
    .map(([category, amount]) => ({ category, amount }))
    .sort((a, b) => a.category.localeCompare(b.category));
  const total = lines.reduce((a, l) => a + l.amount, 0);
  return { title, lines, total };
}

/** Sum the client's share (GBP) of a set of rows, rounded per row to match the
 *  filing path. */
function sumRows(rows: EditorEntry[], fxRates: Record<string, number>): number {
  return round2(rows.reduce((a, r) => a + round2(shareAdjustedGbp(r, fxRates)), 0));
}

function buildBucket(label: string, sublabel: string | null | undefined, rows: EditorEntry[], fxRates: Record<string, number>, unallocated: boolean): PnLBucket {
  const income  = buildSection('Income', rows.filter(r => r.entry_type === 'income'), fxRates);
  const expenseRows = rows.filter(r => r.entry_type === 'expense');
  // Residential finance costs are relieved as a tax reducer, not deducted — keep
  // them out of the expense section and the net figure.
  const deductibleRows = expenseRows.filter(r => !isResidentialFinanceCost(r.category));
  const resiRows       = expenseRows.filter(r =>  isResidentialFinanceCost(r.category));
  const expense = buildSection('Expense', deductibleRows, fxRates);
  return {
    label, sublabel: sublabel ?? undefined, unallocated,
    income, expense,
    residentialFinanceCost: sumRows(resiRows, fxRates),
    net: income.total - expense.total,
    rowCount: rows.length,
  };
}

export function buildPnL(opts: {
  stream: MtdItStream;
  entries: EditorEntry[];
  trades: MtdItTrade[];
  properties: MtdItProperty[];
  fxRates: Record<string, number>;
}): PnLForStream {
  const { stream, trades, properties, fxRates } = opts;

  // Exclude flagged + deleted; the P&L mirrors the editor's "clean" totals.
  const clean = opts.entries.filter(e => !e._deleted && !isEntryFlagged(e));

  const income = buildSection('Income', clean.filter(r => r.entry_type === 'income'), fxRates);
  const cleanExpense   = clean.filter(r => r.entry_type === 'expense');
  const deductibleRows = cleanExpense.filter(r => !isResidentialFinanceCost(r.category));
  const resiRows       = cleanExpense.filter(r =>  isResidentialFinanceCost(r.category));
  const expense = buildSection('Expense', deductibleRows, fxRates);
  const residentialFinanceCost = sumRows(resiRows, fxRates);

  // Build the per-trade or per-property breakdown.
  const breakdown: PnLBucket[] = [];
  if (stream === 'sole') {
    const byTrade = new Map<string, EditorEntry[]>();
    const unalloc: EditorEntry[] = [];
    for (const e of clean) {
      if (e.trade_id) {
        const arr = byTrade.get(e.trade_id) ?? [];
        arr.push(e); byTrade.set(e.trade_id, arr);
      } else {
        unalloc.push(e);
      }
    }
    for (const t of trades) {
      const rows = byTrade.get(t.id);
      if (!rows || rows.length === 0) continue;
      breakdown.push(buildBucket(t.name, t.description, rows, fxRates, false));
    }
    // Tail bucket — only if there are unallocated rows AND some allocated rows
    if (unalloc.length > 0 && breakdown.length > 0) {
      breakdown.push(buildBucket('Unallocated', null, unalloc, fxRates, true));
    }
  } else {
    const isUk = stream === 'uk_rental';
    const byProperty = new Map<string, EditorEntry[]>();
    const unalloc: EditorEntry[] = [];
    for (const e of clean) {
      if (e.property_id) {
        const arr = byProperty.get(e.property_id) ?? [];
        arr.push(e); byProperty.set(e.property_id, arr);
      } else {
        unalloc.push(e);
      }
    }
    for (const p of properties) {
      if (p.property_type !== (isUk ? 'uk' : 'foreign')) continue;
      const rows = byProperty.get(p.id);
      if (!rows || rows.length === 0) continue;
      breakdown.push(buildBucket(p.address, p.country, rows, fxRates, false));
    }
    if (unalloc.length > 0 && breakdown.length > 0) {
      breakdown.push(buildBucket('Unallocated', null, unalloc, fxRates, true));
    }
  }

  // Rows that had a non-GBP currency without any usable rate
  const unconvertedCount = clean.filter(e => {
    if (e.currency === 'GBP') return false;
    if (typeof e.gbp_amount === 'number') return false;
    const r = e.fx_rate ?? fxRates[e.currency];
    return !r || !Number.isFinite(r);
  }).length;

  return {
    stream,
    streamLabel: STREAM_LABEL[stream],
    income,
    expense,
    residentialFinanceCost,
    residentialFinanceReducer: round2(residentialFinanceCost * RESIDENTIAL_FINANCE_REDUCER_RATE),
    net: income.total - expense.total,
    rowCount: clean.length,
    breakdown,
    unconvertedCount,
  };
}

export function fmtMoneyGbp(amount: number): string {
  try {
    return new Intl.NumberFormat('en-GB', {
      style: 'currency',
      currency: 'GBP',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `£${amount.toFixed(2)}`;
  }
}
