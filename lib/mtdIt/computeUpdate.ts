// Cumulative (year-to-date) MTD-IT update compute — the single source of truth
// for the figures we preview and (later) submit per business source.
//
// MTD-IT 2025/26+ is CUMULATIVE: each quarter we report YTD totals from the
// tax-year start to the end of the chosen quarter, per business source.
//
// Figures mirror the review-phase P&L EXACTLY (same GBP conversion, same
// flagged-exclusion) so what's submitted equals what the user approved. We do
// NOT silently apply co-owner share_pct here — if any entry carries a partial
// share we surface a warning instead of quietly diverging from the P&L.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { MtdItQuarterType } from '@/types';
import { getQuarterDates } from './quarters';
import { classifySeExpense, classifyPropertyExpense } from './categoryMap';

export type TypeOfBusiness = 'self-employment' | 'uk-property' | 'foreign-property';

export interface BusinessSource {
  kind: 'trade' | 'property';
  id: string;
  hmrcBusinessId: string | null;
  typeOfBusiness: TypeOfBusiness;
  name: string;
}

export interface CumulativeResult {
  typeOfBusiness: TypeOfBusiness;
  businessId: string | null;
  name: string;
  periodStartDate: string;     // YYYY-MM-DD (tax-year start)
  periodEndDate: string;       // YYYY-MM-DD (selected quarter end)
  income: number;              // total income (GBP), → turnover / rents
  /** Itemised expense totals keyed by the HMRC field name (self-employment or
   *  property fields, depending on the source type). */
  expensesByField: Record<string, number>;
  /** Single consolidated expense total (used for property, or SE if requested). */
  consolidatedExpenses: number;
  rowCount: number;
  warnings: string[];
}

interface EntryRow {
  quarter_id: string;
  stream: string;
  trade_id: string | null;
  property_id: string | null;
  entry_type: string;
  category: string | null;
  gross_amount: number | null;
  gbp_amount: number | null;
  currency: string | null;
  fx_rate: number | null;
  share_pct: number | null;
  flagged_reason: string | null;
  flag_dismissed: boolean | null;
}

const STREAM_FOR_TYPE: Record<TypeOfBusiness, 'sole' | 'uk_rental' | 'foreign_rental'> = {
  'self-employment': 'sole', 'uk-property': 'uk_rental', 'foreign-property': 'foreign_rental',
};

function round2(n: number): number { return Math.round(n * 100) / 100; }

/** GBP value for a row — identical rule to lib/mtdIt/pnl.ts. */
function gbp(e: EntryRow, fxRates: Record<string, number>): number {
  const gross = e.gross_amount || 0;
  if (!e.currency || e.currency === 'GBP') return gross;
  if (typeof e.gbp_amount === 'number') return e.gbp_amount;
  const rate = e.fx_rate ?? fxRates[e.currency];
  if (!rate || !Number.isFinite(rate)) return 0;
  return gross * rate;
}

/**
 * Compute the YTD cumulative figures for one business source up to and
 * including `uptoQuarter`.
 */
export async function computeMtdItCumulative(
  supabase: SupabaseClient,
  opts: {
    clientId: string;
    taxYear: number;                 // our int form (2026 = 2026/27)
    quarterType: MtdItQuarterType;
    uptoQuarter: 1 | 2 | 3 | 4;
    source: BusinessSource;
  },
): Promise<CumulativeResult> {
  const { clientId, taxYear, quarterType, uptoQuarter, source } = opts;
  const warnings: string[] = [];

  // YTD window: Q1 start → selected quarter end.
  const periodStartDate = getQuarterDates(taxYear, 1, quarterType).from;
  const periodEndDate = getQuarterDates(taxYear, uptoQuarter, quarterType).to;

  // Quarters in scope (this client, this tax year, up to the chosen quarter).
  const { data: quarters } = await supabase
    .from('mtd_it_quarters')
    .select('id, quarter, fx_rates')
    .eq('client_id', clientId).eq('tax_year', taxYear).lte('quarter', uptoQuarter);
  const fxByQuarter = new Map<string, Record<string, number>>();
  for (const q of quarters ?? []) fxByQuarter.set(q.id as string, (q.fx_rates as Record<string, number>) ?? {});
  const quarterIds = (quarters ?? []).map(q => q.id as string);

  const expensesByField: Record<string, number> = {};
  let income = 0, consolidatedExpenses = 0, rowCount = 0, sharedRows = 0;

  if (quarterIds.length > 0) {
    const stream = STREAM_FOR_TYPE[source.typeOfBusiness];
    // How many active sources of this stream the client has. With a single
    // source, UNALLOCATED entries on that stream belong to it (this matches the
    // review-phase P&L stream total). With several, only entries explicitly
    // allocated to this source count.
    let siblingCount = 0;
    if (source.kind === 'trade') {
      const { count } = await supabase.from('mtd_it_trades').select('id', { count: 'exact', head: true })
        .eq('client_id', clientId).eq('active', true);
      siblingCount = count ?? 0;
    } else {
      const ptype = source.typeOfBusiness === 'foreign-property' ? 'foreign' : 'uk';
      const { count } = await supabase.from('mtd_it_properties').select('id', { count: 'exact', head: true })
        .eq('client_id', clientId).eq('active', true).eq('property_type', ptype);
      siblingCount = count ?? 0;
    }
    const onlySource = siblingCount <= 1;

    // Pull all of this stream's entries across the YTD quarters, then attribute.
    const { data: entries } = await supabase
      .from('mtd_it_entries')
      .select('quarter_id, stream, trade_id, property_id, entry_type, category, gross_amount, gbp_amount, currency, fx_rate, share_pct, flagged_reason, flag_dismissed')
      .in('quarter_id', quarterIds).eq('stream', stream);

    for (const e of (entries ?? []) as EntryRow[]) {
      // Exclude unresolved flagged entries — same as the P&L's clean totals.
      if (e.flagged_reason && !e.flag_dismissed) continue;
      // Does this entry belong to this source? Allocated to it, or unallocated
      // when this is the only source of the stream.
      const alloc = source.kind === 'trade' ? e.trade_id : e.property_id;
      const belongs = alloc === source.id || (alloc == null && onlySource);
      if (!belongs) continue;
      const value = round2(gbp(e, fxByQuarter.get(e.quarter_id) ?? {}));
      if (e.share_pct != null && e.share_pct < 100) sharedRows++;
      rowCount++;
      if (e.entry_type === 'income') {
        income += value;
      } else {
        consolidatedExpenses += value;
        const field = source.typeOfBusiness === 'self-employment'
          ? classifySeExpense(e.category)
          : classifyPropertyExpense(e.category);
        expensesByField[field] = round2((expensesByField[field] ?? 0) + value);
      }
    }
  }

  if (sharedRows > 0) {
    warnings.push(`${sharedRows} entr${sharedRows === 1 ? 'y has' : 'ies have'} a co-owner share below 100% — these figures use the full amount (matching the P&L). Confirm the client's declared share before filing.`);
  }
  if (!source.hmrcBusinessId) {
    warnings.push('This source is not yet linked to an HMRC business — map it on the HMRC setup screen before filing.');
  }

  return {
    typeOfBusiness: source.typeOfBusiness,
    businessId: source.hmrcBusinessId,
    name: source.name,
    periodStartDate,
    periodEndDate,
    income: round2(income),
    expensesByField,
    consolidatedExpenses: round2(consolidatedExpenses),
    rowCount,
    warnings,
  };
}
