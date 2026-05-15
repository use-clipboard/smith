// Build P&L data for the review-phase "P&L View" modal.
//
// Rules:
// • Flagged entries are excluded (same as the editor's headline totals).
// • Foreign-rental amounts are converted to GBP using each row's fx_rate,
//   falling back to the quarter-level fxRates map. Rows without any usable
//   rate contribute 0 to the GBP total (and surface in `unconverted`).
// • Breakdown by trade (sole) or property (rental) — rows without a
//   trade/property go into an "Unallocated" bucket. If every row is
//   unallocated, the breakdown is suppressed (caller can show just the
//   stream-level P&L).

import type { EditorEntry } from '@/components/features/mtd-it/MtdItStreamColumn';
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
  expense: PnLSection;
  net: number;
  /** Number of rows that fell into this bucket. */
  rowCount: number;
}
export interface PnLForStream {
  stream: MtdItStream;
  streamLabel: string;
  /** Aggregated income section across the whole stream. */
  income: PnLSection;
  /** Aggregated expense section across the whole stream. */
  expense: PnLSection;
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

/** GBP value for a single row, applying fx_rate (or quarter-level fallback). */
function gbpAmount(e: EditorEntry, fxRates: Record<string, number>): number {
  const gross = e.gross_amount || 0;
  if (e.currency === 'GBP') return gross;
  if (typeof e.gbp_amount === 'number') return e.gbp_amount;
  const rate = e.fx_rate ?? fxRates[e.currency];
  if (!rate || !Number.isFinite(rate)) return 0;
  return gross * rate;
}

function emptySection(title: string): PnLSection { return { title, lines: [], total: 0 }; }

function buildSection(title: string, entries: EditorEntry[], fxRates: Record<string, number>): PnLSection {
  const byCategory = new Map<string, number>();
  for (const e of entries) {
    const v = gbpAmount(e, fxRates);
    byCategory.set(e.category, (byCategory.get(e.category) ?? 0) + v);
  }
  const lines = Array.from(byCategory.entries())
    .map(([category, amount]) => ({ category, amount }))
    .sort((a, b) => a.category.localeCompare(b.category));
  const total = lines.reduce((a, l) => a + l.amount, 0);
  return { title, lines, total };
}

function buildBucket(label: string, sublabel: string | null | undefined, rows: EditorEntry[], fxRates: Record<string, number>, unallocated: boolean): PnLBucket {
  const income  = buildSection('Income',  rows.filter(r => r.entry_type === 'income'),  fxRates);
  const expense = buildSection('Expense', rows.filter(r => r.entry_type === 'expense'), fxRates);
  return {
    label, sublabel: sublabel ?? undefined, unallocated,
    income, expense,
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
  const clean = opts.entries.filter(e => !e._deleted && !(e.flagged_reason && !e.flag_dismissed));

  const income  = buildSection('Income',  clean.filter(r => r.entry_type === 'income'),  fxRates);
  const expense = buildSection('Expense', clean.filter(r => r.entry_type === 'expense'), fxRates);

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
