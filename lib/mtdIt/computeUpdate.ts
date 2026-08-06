// Cumulative (year-to-date) MTD-IT update compute — the single source of truth
// for the figures we preview and (later) submit per business source.
//
// MTD-IT 2025/26+ is CUMULATIVE: each quarter we report YTD totals from the
// tax-year start to the end of the chosen quarter, per business source.
//
// Figures mirror the review-phase P&L EXACTLY (same GBP conversion, same
// share_pct, same flagged-exclusion, same per-row rounding) so what's submitted
// equals what the user approved. Every value goes through lib/mtdIt/amounts —
// don't re-implement the conversion here.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { MtdItQuarterType, MtdItStream } from '@/types';
import { round2, shareAdjustedGbp } from './amounts';
import { isEntryFlagged, reflagStoredRows } from './flags';
import { getQuarterDates } from './quarters';
import { classifySeExpense, classifyPropertyExpense } from './categoryMap';
import { isResidentialFinanceCost } from './financeCosts';
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
  /** Single consolidated expense total (used for property, or SE if requested).
   *  EXCLUDES residential finance costs — those are relieved via a tax reducer,
   *  not deducted, and are reported separately (see residentialFinanceCost). */
  consolidatedExpenses: number;
  /** Restricted residential finance costs (ITTOIA s.272A) for the period, in
   *  GBP. Property streams only; held OUT of expensesByField/consolidatedExpenses
   *  and reported to HMRC in the separate `residentialFinancialCost` field. */
  residentialFinanceCost: number;
  /** Unrelieved residential finance costs brought forward from the prior tax
   *  year (a manual figure from the prior-year computation). Reported alongside
   *  the current-period amount. Set by computeFilingUnits, per business type. */
  residentialFinanceCostBroughtFwd: number;
  rowCount: number;
  warnings: string[];
}

interface EntryRow {
  quarter_id: string;
  // Narrowed from `string` so the row satisfies FlaggableEntry — the query
  // filters on stream, so the value is always one of these.
  stream: MtdItStream;
  trade_id: string | null;
  property_id: string | null;
  entry_type: string;
  category: string | null;
  entry_date: string | null;
  supplier: string | null;
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
  // Each quarter has its own date window, so out-of-range has to be judged
  // per quarter — see the reflag step below.
  const rangeByQuarter = new Map<string, { from: string; to: string }>();
  for (const q of quarters ?? []) {
    fxByQuarter.set(q.id as string, (q.fx_rates as Record<string, number>) ?? {});
    rangeByQuarter.set(q.id as string, getQuarterDates(taxYear, q.quarter as 1 | 2 | 3 | 4, quarterType));
  }
  const quarterIds = (quarters ?? []).map(q => q.id as string);

  const expensesByField: Record<string, number> = {};
  let income = 0, consolidatedExpenses = 0, residentialFinanceCost = 0, rowCount = 0, sharedRows = 0, flaggedExcluded = 0;

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
      .select('quarter_id, stream, trade_id, property_id, entry_type, category, entry_date, supplier, gross_amount, gbp_amount, currency, fx_rate, share_pct, flagged_reason, flag_dismissed')
      .in('quarter_id', quarterIds).eq('stream', stream);

    // Derive flags exactly as the review editor does, per quarter (each has its
    // own date window). Out-of-range and duplicate flags are NOT persisted, so
    // reading the stored flagged_reason alone would both miss real problems and
    // honour stale strings an older build wrote. See lib/mtdIt/flags.
    const reflagged: EntryRow[] = [];
    for (const [qid, range] of rangeByQuarter) {
      const forQuarter = ((entries ?? []) as EntryRow[]).filter(e => e.quarter_id === qid);
      if (forQuarter.length > 0) reflagged.push(...reflagStoredRows(forQuarter, range.from, range.to));
    }

    for (const e of reflagged) {
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
      if (isEntryFlagged(e)) { flaggedExcluded++; continue; }
      const value = round2(shareAdjustedGbp(e, fxByQuarter.get(e.quarter_id) ?? {}));
      if (e.share_pct != null && e.share_pct < 100) sharedRows++;
      rowCount++;
      if (e.entry_type === 'income') {
        income += value;
      } else if (source.typeOfBusiness !== 'self-employment' && isResidentialFinanceCost(e.category)) {
        // Restricted residential finance cost — relieved as a 20% tax reducer,
        // NOT deducted. Kept out of both the itemised fields and the
        // consolidated total; reported to HMRC in its own field.
        residentialFinanceCost += value;
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
    warnings.push(`${sharedRows} entr${sharedRows === 1 ? 'y is' : 'ies are'} split with a co-owner — only the client's share is included in these figures. Confirm the declared share before filing.`);
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
    residentialFinanceCost: round2(residentialFinanceCost),
    residentialFinanceCostBroughtFwd: 0, // set per business type in computeFilingUnits
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
  residentialFinanceCost: number;
  /** Brought-forward unrelieved residential finance cost. The stored figure is
   *  per foreign-property business (not per country); it's attached to the first
   *  country split so the foreign body carries it exactly once. */
  residentialFinanceCostBroughtFwd: number;
}

/** Per-property foreign split (for TY 2026-27+ def2, keyed by HMRC propertyId
 *  resolved at submit time from `smithPropertyId`). */
export interface ForeignPropertySplit {
  smithPropertyId: string;   // mtd_it_properties.id
  address: string;
  country: string | null;
  income: number;
  expensesByField: Record<string, number>;
  consolidatedExpenses: number;
  residentialFinanceCost: number;
  residentialFinanceCostBroughtFwd: number;
}

export interface FilingUnit {
  typeOfBusiness: TypeOfBusiness;
  businessId: string | null;
  name: string;
  figures: CumulativeResult;        // aggregated totals for this unit
  sourceIds: string[];              // the trade/property ids that compose it
  foreignCountries?: ForeignCountrySplit[];   // foreign-property, def1 (TY 2025-26)
  foreignProperties?: ForeignPropertySplit[]; // foreign-property, def2 (TY 2026-27+)
}

interface FilingTrade { id: string; name: string; hmrcBusinessId: string | null }
interface FilingProperty { id: string; address: string; propertyType: 'uk' | 'foreign'; country: string | null; hmrcBusinessId: string | null }

/** The result of planning a filing: the units to file, plus anything that must
 *  be fixed first. `errors` is fatal — the submit route refuses to file while
 *  it's non-empty. That's stricter than `figures.warnings`, which are advisory
 *  nudges shown in the preview. */
export interface FilingPlan {
  units: FilingUnit[];
  errors: string[];
}

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
): Promise<FilingPlan> {
  const { clientId, taxYear, quarterType, uptoQuarter, trades, props } = opts;
  const base = { clientId, taxYear, quarterType, uptoQuarter };
  const units: FilingUnit[] = [];
  const errors: string[] = [];

  // Brought-forward unrelieved residential finance costs (manual, per tax year,
  // per property business). Reported alongside the current-period figure.
  const { data: bfRows } = await supabase
    .from('mtd_it_finance_bf')
    .select('stream, amount')
    .eq('client_id', clientId).eq('tax_year', taxYear);
  const bfByStream = new Map<string, number>();
  for (const r of bfRows ?? []) bfByStream.set(r.stream as string, Number(r.amount ?? 0));
  const ukBroughtFwd = round2(bfByStream.get('uk_rental') ?? 0);
  const foreignBroughtFwd = round2(bfByStream.get('foreign_rental') ?? 0);

  // Self-employment — one unit per trade.
  let seAllocIncome = 0, seAllocExpense = 0;
  for (const t of trades) {
    const source: BusinessSource = { kind: 'trade', id: t.id, hmrcBusinessId: t.hmrcBusinessId, typeOfBusiness: 'self-employment', name: t.name };
    const figures = await computeMtdItCumulative(supabase, { ...base, source });
    seAllocIncome += figures.income; seAllocExpense += figures.consolidatedExpenses;
    units.push({ typeOfBusiness: 'self-employment', businessId: t.hmrcBusinessId, name: t.name, figures, sourceIds: [t.id] });
  }

  // With one trade, computeMtdItCumulative sweeps untagged sole entries into it
  // (see `onlySource`). With two or more, an untagged entry matches NO trade and
  // is silently dropped — the P&L still shows it under "Unallocated", so the
  // review screen and the filing disagree and nothing says so. Reconcile the
  // whole stream against the sum of the per-trade units and refuse to file on a
  // gap. This mirrors the check foreign property already does below.
  if (trades.length > 1) {
    const probe: BusinessSource = { kind: 'trade', id: trades[0].id, hmrcBusinessId: null, typeOfBusiness: 'self-employment', name: 'All trades' };
    const whole = await computeMtdItCumulative(supabase, { ...base, source: probe, aggregateStream: true });
    if (whole.income - seAllocIncome > 0.01 || whole.consolidatedExpenses - seAllocExpense > 0.01) {
      errors.push(
        "Some sole-trade entries aren't allocated to a trade. With more than one trade we can't tell which business they belong to, so they'd be left out of the filing entirely — set the Trade on each untagged row in Review & adjust.",
      );
    }
  }

  // UK property — aggregate every UK rental entry into the single UK business.
  const uk = props.filter(p => p.propertyType === 'uk');
  if (uk.length > 0) {
    const businessId = uk.map(p => p.hmrcBusinessId).find(Boolean) ?? null;
    const source: BusinessSource = { kind: 'property', id: uk[0].id, hmrcBusinessId: businessId, typeOfBusiness: 'uk-property', name: 'UK property' };
    const figures = await computeMtdItCumulative(supabase, { ...base, source, aggregateStream: true });
    figures.residentialFinanceCostBroughtFwd = ukBroughtFwd;
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
    figures.residentialFinanceCostBroughtFwd = foreignBroughtFwd;

    const resolved = fg.map(p => ({ p, code: resolveCountryCode(p.country) }));
    const distinctCodes = [...new Set(resolved.filter(r => r.code).map(r => r.code as string))];
    const anyUnresolved = resolved.some(r => !r.code);

    let foreignCountries: ForeignCountrySplit[];
    if (distinctCodes.length <= 1 && !anyUnresolved) {
      // One country (or all the same): file the whole stream total under it,
      // so unallocated entries are included rather than dropped. The whole b/f
      // pool sits on this single country entry.
      const code = distinctCodes[0] ?? null;
      foreignCountries = [{ countryCode: code, rawCountry: fg[0].country, income: figures.income, expensesByField: figures.expensesByField, consolidatedExpenses: figures.consolidatedExpenses, residentialFinanceCost: figures.residentialFinanceCost, residentialFinanceCostBroughtFwd: foreignBroughtFwd }];
      if (!code) figures.warnings.push('Set a country on the foreign property before filing.');
    } else {
      // Multiple countries (or some unrecognised): split per property by
      // allocation. Warn loudly about anything that would be left out.
      const byKey = new Map<string, ForeignCountrySplit>();
      let allocIncome = 0, allocExpense = 0, allocResiFinance = 0;
      for (const { p, code } of resolved) {
        const src: BusinessSource = { kind: 'property', id: p.id, hmrcBusinessId: businessId, typeOfBusiness: 'foreign-property', name: p.address };
        const fig = await computeMtdItCumulative(supabase, { ...base, source: src });
        allocIncome += fig.income; allocExpense += fig.consolidatedExpenses; allocResiFinance += fig.residentialFinanceCost;
        const key = code ?? `__unresolved__${p.id}`;
        const entry = byKey.get(key) ?? { countryCode: code, rawCountry: p.country, income: 0, expensesByField: {}, consolidatedExpenses: 0, residentialFinanceCost: 0, residentialFinanceCostBroughtFwd: 0 };
        entry.income += fig.income;
        entry.consolidatedExpenses += fig.consolidatedExpenses;
        entry.residentialFinanceCost = round2(entry.residentialFinanceCost + fig.residentialFinanceCost);
        for (const [f, v] of Object.entries(fig.expensesByField)) entry.expensesByField[f] = round2((entry.expensesByField[f] ?? 0) + v);
        byKey.set(key, entry);
      }
      foreignCountries = [...byKey.values()];
      // Brought-forward is a single business-level figure; attach it to the
      // first country split so the foreign body carries it exactly once.
      if (foreignCountries.length > 0) foreignCountries[0].residentialFinanceCostBroughtFwd = foreignBroughtFwd;
      if (figures.income - allocIncome > 0.01 || figures.consolidatedExpenses - allocExpense > 0.01 || figures.residentialFinanceCost - allocResiFinance > 0.01) {
        figures.warnings.push("Some foreign rental entries aren't allocated to a property, so they can't be assigned a country — allocate them or they'll be left out of the filing.");
      }
      if (anyUnresolved) figures.warnings.push('A foreign property has an unrecognised country — fix it before filing.');
    }

    // Per-property splits for TY 2026-27+ (def2): HMRC keys the foreign body by
    // propertyId, so each property files its own figures. Computed independently
    // of the country logic above; the propertyId is resolved at submit time.
    const foreignProperties: ForeignPropertySplit[] = [];
    let ppIncome = 0, ppExpense = 0, ppResiFinance = 0;
    for (const p of fg) {
      const src: BusinessSource = { kind: 'property', id: p.id, hmrcBusinessId: businessId, typeOfBusiness: 'foreign-property', name: p.address };
      const fig = await computeMtdItCumulative(supabase, { ...base, source: src });
      ppIncome += fig.income; ppExpense += fig.consolidatedExpenses; ppResiFinance += fig.residentialFinanceCost;
      foreignProperties.push({
        smithPropertyId: p.id, address: p.address, country: p.country,
        income: round2(fig.income), expensesByField: fig.expensesByField,
        consolidatedExpenses: round2(fig.consolidatedExpenses),
        residentialFinanceCost: round2(fig.residentialFinanceCost),
        residentialFinanceCostBroughtFwd: 0,
      });
    }
    // Business-level b/f rides on the first property entry (carried once).
    if (foreignProperties.length > 0) foreignProperties[0].residentialFinanceCostBroughtFwd = foreignBroughtFwd;
    // Unallocated foreign entries can't be assigned to a property → they'd be
    // dropped from a def2 filing. Warn (only add once; the country branch may
    // already have warned for its own reason).
    if ((figures.income - ppIncome > 0.01 || figures.consolidatedExpenses - ppExpense > 0.01 || figures.residentialFinanceCost - ppResiFinance > 0.01)
        && !figures.warnings.some(w => w.includes("aren't allocated to a property"))) {
      figures.warnings.push("Some foreign rental entries aren't allocated to a property, so they can't be filed from 2026-27 — allocate them to a property before filing.");
    }

    units.push({
      typeOfBusiness: 'foreign-property', businessId,
      name: fg.length === 1 ? fg[0].address : `Foreign property (${fg.length} properties)`,
      figures, sourceIds: fg.map(p => p.id), foreignCountries, foreignProperties,
    });
  }

  return { units, errors };
}
