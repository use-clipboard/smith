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
import { resolveCountryCode } from './countryCodes';

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
    /**
     * Aggregate the WHOLE stream for this business type, ignoring per-source
     * (per-property/per-trade) allocation. HMRC models all UK property as one
     * business and all foreign property as one business, so a multi-property
     * client must file the combined stream total — not one property at a time
     * (which would drop unallocated entries and under-declare). Used for
     * property filing units; self-employment stays per-trade.
     */
    aggregateStream?: boolean;
  },
): Promise<CumulativeResult> {
  const { clientId, taxYear, quarterType, uptoQuarter, source, aggregateStream } = opts;
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
  let income = 0, consolidatedExpenses = 0, rowCount = 0, sharedRows = 0, flaggedExcluded = 0;

  if (quarterIds.length > 0) {
    const stream = STREAM_FOR_TYPE[source.typeOfBusiness];
    // How many active sources of this stream the client has. With a single
    // source, UNALLOCATED entries on that stream belong to it (this matches the
    // review-phase P&L stream total). With several, only entries explicitly
    // allocated to this source count. In aggregateStream mode this is moot —
    // every entry on the stream is included regardless of allocation.
    let onlySource = true;
    if (!aggregateStream) {
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
      onlySource = siblingCount <= 1;
    }

    // Pull all of this stream's entries across the YTD quarters, then attribute.
    const { data: entries } = await supabase
      .from('mtd_it_entries')
      .select('quarter_id, stream, trade_id, property_id, entry_type, category, gross_amount, gbp_amount, currency, fx_rate, share_pct, flagged_reason, flag_dismissed')
      .in('quarter_id', quarterIds).eq('stream', stream);

    for (const e of (entries ?? []) as EntryRow[]) {
      // Does this entry belong to this source? In aggregateStream mode every
      // entry on the stream counts. Otherwise: allocated to it, or unallocated
      // when this is the only source of the stream. (Attribution comes first so
      // we can count flagged rows that belong to THIS source.)
      if (!aggregateStream) {
        const alloc = source.kind === 'trade' ? e.trade_id : e.property_id;
        const belongs = alloc === source.id || (alloc == null && onlySource);
        if (!belongs) continue;
      }
      // Exclude unresolved flagged entries — same as the P&L's clean totals —
      // but count them so we can warn that they're being left out of the filing.
      if (e.flagged_reason && !e.flag_dismissed) { flaggedExcluded++; continue; }
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

  // ── Pre-submit sanity checks ────────────────────────────────────────────────
  // Non-blocking "does this look right?" nudges, surfaced in the submit preview.
  const roundedIncome   = round2(income);
  const roundedExpenses = round2(consolidatedExpenses);
  if (flaggedExcluded > 0) {
    warnings.push(`${flaggedExcluded} flagged entr${flaggedExcluded === 1 ? 'y is' : 'ies are'} excluded from these figures — clear the flag or fix the issue, otherwise ${flaggedExcluded === 1 ? "it won't" : "they won't"} be filed.`);
  }
  if (rowCount === 0) {
    warnings.push('No entries recorded for this business this period — a nil (zero) update will be filed.');
  } else if (roundedIncome === 0 && roundedExpenses > 0) {
    warnings.push('Expenses are recorded but income is zero — check whether income is missing before filing.');
  } else if (roundedIncome > 0 && roundedExpenses > roundedIncome) {
    warnings.push('Expenses exceed income (a loss for the period) — confirm this is correct before filing.');
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

// ── Filing units ────────────────────────────────────────────────────────────
// Turn a client's trades + properties into the ACTUAL units HMRC files against:
//   • self-employment  → one unit per trade (each trade is its own HMRC business)
//   • uk-property      → ONE aggregated unit (HMRC has a single UK-property business)
//   • foreign-property → ONE aggregated unit (single foreign-property business),
//                        split by country for the body
// This is the single source of truth shared by the submit preview and the real
// submission, so the figures previewed are exactly the figures filed.

export interface ForeignCountrySplit {
  countryCode: string | null;   // ISO alpha-3, or null when the property's country can't be resolved
  rawCountry: string | null;    // what the user typed (for messaging)
  income: number;
  expensesByField: Record<string, number>;
  consolidatedExpenses: number;
}

export interface FilingUnit {
  typeOfBusiness: TypeOfBusiness;
  businessId: string | null;
  name: string;
  figures: CumulativeResult;        // aggregated totals for this unit
  sourceIds: string[];              // the trade/property ids that compose it
  foreignCountries?: ForeignCountrySplit[]; // foreign-property only
}

interface FilingTrade { id: string; name: string; hmrcBusinessId: string | null }
interface FilingProperty { id: string; address: string; propertyType: 'uk' | 'foreign'; country: string | null; hmrcBusinessId: string | null }

export async function computeFilingUnits(
  supabase: SupabaseClient,
  opts: {
    clientId: string;
    taxYear: number;
    quarterType: MtdItQuarterType;
    uptoQuarter: 1 | 2 | 3 | 4;
    trades: FilingTrade[];
    props: FilingProperty[];
  },
): Promise<FilingUnit[]> {
  const { clientId, taxYear, quarterType, uptoQuarter, trades, props } = opts;
  const base = { clientId, taxYear, quarterType, uptoQuarter };
  const units: FilingUnit[] = [];

  // Self-employment — one unit per trade.
  for (const t of trades) {
    const source: BusinessSource = { kind: 'trade', id: t.id, hmrcBusinessId: t.hmrcBusinessId, typeOfBusiness: 'self-employment', name: t.name };
    const figures = await computeMtdItCumulative(supabase, { ...base, source });
    units.push({ typeOfBusiness: 'self-employment', businessId: t.hmrcBusinessId, name: t.name, figures, sourceIds: [t.id] });
  }

  // UK property — aggregate every UK rental entry into the single UK business.
  const uk = props.filter(p => p.propertyType === 'uk');
  if (uk.length > 0) {
    const businessId = uk.map(p => p.hmrcBusinessId).find(Boolean) ?? null;
    const source: BusinessSource = { kind: 'property', id: uk[0].id, hmrcBusinessId: businessId, typeOfBusiness: 'uk-property', name: 'UK property' };
    const figures = await computeMtdItCumulative(supabase, { ...base, source, aggregateStream: true });
    units.push({
      typeOfBusiness: 'uk-property', businessId,
      name: uk.length === 1 ? uk[0].address : `UK property (${uk.length} properties)`,
      figures, sourceIds: uk.map(p => p.id),
    });
  }

  // Foreign property — aggregate into the single foreign business, split by country.
  const fg = props.filter(p => p.propertyType === 'foreign');
  if (fg.length > 0) {
    const businessId = fg.map(p => p.hmrcBusinessId).find(Boolean) ?? null;
    // Whole-stream total (captures unallocated entries too).
    const totalSource: BusinessSource = { kind: 'property', id: fg[0].id, hmrcBusinessId: businessId, typeOfBusiness: 'foreign-property', name: 'Foreign property' };
    const figures = await computeMtdItCumulative(supabase, { ...base, source: totalSource, aggregateStream: true });

    const resolved = fg.map(p => ({ p, code: resolveCountryCode(p.country) }));
    const distinctCodes = [...new Set(resolved.filter(r => r.code).map(r => r.code as string))];
    const anyUnresolved = resolved.some(r => !r.code);

    let foreignCountries: ForeignCountrySplit[];
    if (distinctCodes.length <= 1 && !anyUnresolved) {
      // One country (or all the same): file the whole stream total under it,
      // so unallocated entries are included rather than dropped.
      const code = distinctCodes[0] ?? null;
      foreignCountries = [{ countryCode: code, rawCountry: fg[0].country, income: figures.income, expensesByField: figures.expensesByField, consolidatedExpenses: figures.consolidatedExpenses }];
      if (!code) figures.warnings.push('Set a country on the foreign property before filing.');
    } else {
      // Multiple countries (or some unrecognised): split per property by
      // allocation. Warn loudly about anything that would be left out.
      const byKey = new Map<string, ForeignCountrySplit>();
      let allocIncome = 0, allocExpense = 0;
      for (const { p, code } of resolved) {
        const src: BusinessSource = { kind: 'property', id: p.id, hmrcBusinessId: businessId, typeOfBusiness: 'foreign-property', name: p.address };
        const fig = await computeMtdItCumulative(supabase, { ...base, source: src });
        allocIncome += fig.income; allocExpense += fig.consolidatedExpenses;
        const key = code ?? `__unresolved__${p.id}`;
        const entry = byKey.get(key) ?? { countryCode: code, rawCountry: p.country, income: 0, expensesByField: {}, consolidatedExpenses: 0 };
        entry.income += fig.income;
        entry.consolidatedExpenses += fig.consolidatedExpenses;
        for (const [f, v] of Object.entries(fig.expensesByField)) entry.expensesByField[f] = round2((entry.expensesByField[f] ?? 0) + v);
        byKey.set(key, entry);
      }
      foreignCountries = [...byKey.values()];
      if (figures.income - allocIncome > 0.01 || figures.consolidatedExpenses - allocExpense > 0.01) {
        figures.warnings.push("Some foreign rental entries aren't allocated to a property, so they can't be assigned a country — allocate them or they'll be left out of the filing.");
      }
      if (anyUnresolved) figures.warnings.push('A foreign property has an unrecognised country — fix it before filing.');
    }

    units.push({
      typeOfBusiness: 'foreign-property', businessId,
      name: fg.length === 1 ? fg[0].address : `Foreign property (${fg.length} properties)`,
      figures, sourceIds: fg.map(p => p.id), foreignCountries,
    });
  }

  return units;
}
