// Assembles the HMRC request bodies for MTD-IT cumulative period summaries from
// our computed figures. ISOLATED here on purpose: the cumulative endpoints are
// new and the exact envelope can only be fully confirmed against the live
// sandbox. If a sandbox submit returns a validation error about the body shape,
// this is the ONE place to adjust.
//
// Self-employment fields + the periodDates/periodIncome/periodExpenses nesting
// are confirmed against the Self-Employment Business API v5.0 OAS (the discrete
// period-summary schema, which the cumulative endpoint mirrors).

import type { CumulativeResult } from './computeUpdate';

function round2(n: number): number { return Math.round(n * 100) / 100; }

export interface SelfEmploymentCumulativeBody {
  periodDates: { periodStartDate: string; periodEndDate: string };
  periodIncome: { turnover: number };
  periodExpenses: Record<string, number>;
}

/**
 * Build the Self-Employment Cumulative Period Summary body.
 * @param useConsolidated single consolidatedExpenses total (allowed below the
 *   VAT-registration threshold) vs the itemised expense fields.
 */
export function buildSelfEmploymentCumulativeBody(
  r: CumulativeResult,
  useConsolidated: boolean,
): SelfEmploymentCumulativeBody {
  const periodExpenses: Record<string, number> = useConsolidated
    ? { consolidatedExpenses: round2(r.consolidatedExpenses) }
    : Object.fromEntries(
        Object.entries(r.expensesByField)
          .filter(([, v]) => typeof v === 'number' && v !== 0)
          .map(([k, v]) => [k, round2(v as number)]),
      );

  return {
    periodDates: { periodStartDate: r.periodStartDate, periodEndDate: r.periodEndDate },
    periodIncome: { turnover: round2(r.income) },
    periodExpenses,
  };
}

export interface UkPropertyCumulativeBody {
  fromDate: string;
  toDate: string;
  ukProperty: { income: { periodAmount: number }; expenses: Record<string, number> };
}

/**
 * Build the UK Property Cumulative Period Summary body (Property Business API
 * v6.0, non-FHL — FHL abolished April 2025). ISOLATED like the SE builder: the
 * exact cumulative envelope (wrapper key + date fields) is confirmed against the
 * sandbox; if HMRC rejects the shape, adjust here only.
 */
export function buildUkPropertyCumulativeBody(
  r: CumulativeResult,
  useConsolidated: boolean,
): UkPropertyCumulativeBody {
  const expenses: Record<string, number> = useConsolidated
    ? { consolidatedExpenses: round2(r.consolidatedExpenses) }
    : Object.fromEntries(
        Object.entries(r.expensesByField)
          .filter(([, v]) => typeof v === 'number' && v !== 0)
          .map(([k, v]) => [k, round2(v as number)]),
      );
  // Residential finance costs (restricted, ITTOIA s.272A) are reported in their
  // own field, NOT summed into expenses. HMRC's Property Business API permits
  // `residentialFinancialCost`/`residentialFinancialCostsCarriedForward`
  // ALONGSIDE `consolidatedExpenses`, so they emit in both modes. Note the HMRC
  // spelling is "Financial" (not "Finance"). ⚠ verify the exact envelope against
  // the HMRC sandbox — this builder is the ONE place to adjust.
  if (r.residentialFinanceCost > 0) expenses.residentialFinancialCost = round2(r.residentialFinanceCost);
  if (r.residentialFinanceCostBroughtFwd > 0) expenses.residentialFinancialCostsCarriedForward = round2(r.residentialFinanceCostBroughtFwd);
  return {
    fromDate: r.periodStartDate,
    toDate: r.periodEndDate,
    ukProperty: { income: { periodAmount: round2(r.income) }, expenses },
  };
}

// ── Foreign property (Property Business API v6.0) ───────────────────────────
// Unlike UK property, a person has a SINGLE foreign-property business that
// aggregates ALL foreign properties, broken down by country. The cumulative
// body therefore carries a `foreignProperty` ARRAY, one entry per countryCode
// (ISO 3166-1 alpha-3). Expense field names match UK property (PropertyExpenseField).
// ISOLATED like the SE/UK builders — if HMRC rejects the shape, adjust here only.

export interface ForeignPropertyCountryEntry {
  countryCode: string;
  income: number;
  expensesByField: Record<string, number>;
  consolidatedExpenses: number;
  /** Restricted residential finance cost for this country (GBP) — reported in
   *  the separate `residentialFinancialCost` field, not deducted. */
  residentialFinanceCost: number;
  /** Unrelieved residential finance cost brought forward (business-level; only
   *  the first country entry carries it). Emits as `broughtFwdResidentialFinancialCost`. */
  residentialFinanceCostBroughtFwd: number;
}

export interface ForeignPropertyCumulativeBody {
  fromDate: string;
  toDate: string;
  foreignProperty: Array<{
    countryCode: string;
    income: { rentIncome: { rentAmount: number } };
    expenses: Record<string, number>;
  }>;
}

/**
 * Build the Foreign Property Cumulative Period Summary body. Takes one entry per
 * country (already aggregated) plus the shared YTD period dates.
 * @param useConsolidated single consolidatedExpenses total vs itemised fields.
 */
export function buildForeignPropertyCumulativeBody(
  periodStartDate: string,
  periodEndDate: string,
  countries: ForeignPropertyCountryEntry[],
  useConsolidated: boolean,
): ForeignPropertyCumulativeBody {
  return {
    fromDate: periodStartDate,
    toDate: periodEndDate,
    foreignProperty: countries.map(c => {
      const expenses: Record<string, number> = useConsolidated
        ? { consolidatedExpenses: round2(c.consolidatedExpenses) }
        : Object.fromEntries(
            Object.entries(c.expensesByField)
              .filter(([, v]) => typeof v === 'number' && v !== 0)
              .map(([k, v]) => [k, round2(v as number)]),
          );
      // Restricted residential finance cost sits outside the deductible total.
      // Foreign uses the same base field name as UK (`residentialFinancialCost`,
      // "Financial" not "Finance") but a DIFFERENT brought-forward field name
      // (`broughtFwdResidentialFinancialCost`). ⚠ verify against the HMRC sandbox.
      if (c.residentialFinanceCost > 0) expenses.residentialFinancialCost = round2(c.residentialFinanceCost);
      if (c.residentialFinanceCostBroughtFwd > 0) expenses.broughtFwdResidentialFinancialCost = round2(c.residentialFinanceCostBroughtFwd);
      return {
        countryCode: c.countryCode,
        income: { rentIncome: { rentAmount: round2(c.income) } },
        expenses,
      };
    }),
  };
}

// ── Foreign property — TY 2026-27+ (def2, keyed by propertyId) ───────────────
// HMRC changed the foreign-property cumulative body between tax years:
//   • def1 (TY 2025-26)        → each foreignProperty[] item keyed by `countryCode`
//   • def2 (TY 2026-27 onward) → each foreignProperty[] item keyed by `propertyId`
// (a per-property UUID assigned by HMRC, obtained from the foreign-property
// "details" list/create endpoints). The wrapper (`foreignProperty`), income
// (`rentIncome.rentAmount`) and expense field names are identical; only the item
// key differs. Confirmed against the Property Business API v6.0 OAS
// (foreign_property_cumulative_summary_create_and_amend/def1|def2).

/** From which of our int tax years HMRC keys foreign property by propertyId. */
export const FOREIGN_PROPERTY_ID_FROM_TAX_YEAR = 2026;

/** True when the foreign cumulative body must be keyed by propertyId (def2). */
export function foreignCumulativeUsesPropertyId(taxYearInt: number): boolean {
  return taxYearInt >= FOREIGN_PROPERTY_ID_FROM_TAX_YEAR;
}

/** One entry per HMRC foreign property (def2 = TY 2026-27+). Same figures as the
 *  country entry, but keyed by the HMRC `propertyId` instead of a country code. */
export interface ForeignPropertyIdEntry {
  propertyId: string;
  income: number;
  expensesByField: Record<string, number>;
  consolidatedExpenses: number;
  residentialFinanceCost: number;
  residentialFinanceCostBroughtFwd: number;
}

export interface ForeignPropertyByIdCumulativeBody {
  fromDate: string;
  toDate: string;
  foreignProperty: Array<{
    propertyId: string;
    income: { rentIncome: { rentAmount: number } };
    expenses: Record<string, number>;
  }>;
}

/** Shared foreign expense assembly (identical field names for def1 and def2). */
function foreignExpenses(
  e: { expensesByField: Record<string, number>; consolidatedExpenses: number; residentialFinanceCost: number; residentialFinanceCostBroughtFwd: number },
  useConsolidated: boolean,
): Record<string, number> {
  const expenses: Record<string, number> = useConsolidated
    ? { consolidatedExpenses: round2(e.consolidatedExpenses) }
    : Object.fromEntries(
        Object.entries(e.expensesByField)
          .filter(([, v]) => typeof v === 'number' && v !== 0)
          .map(([k, v]) => [k, round2(v as number)]),
      );
  if (e.residentialFinanceCost > 0) expenses.residentialFinancialCost = round2(e.residentialFinanceCost);
  if (e.residentialFinanceCostBroughtFwd > 0) expenses.broughtFwdResidentialFinancialCost = round2(e.residentialFinanceCostBroughtFwd);
  return expenses;
}

/**
 * Build the Foreign Property Cumulative Period Summary body for TY 2026-27+
 * (def2), keyed by HMRC propertyId. Takes one entry per foreign property.
 */
export function buildForeignPropertyByIdCumulativeBody(
  fromDate: string,
  toDate: string,
  properties: ForeignPropertyIdEntry[],
  useConsolidated: boolean,
): ForeignPropertyByIdCumulativeBody {
  return {
    fromDate,
    toDate,
    foreignProperty: properties.map(p => ({
      propertyId: p.propertyId,
      income: { rentIncome: { rentAmount: round2(p.income) } },
      expenses: foreignExpenses(p, useConsolidated),
    })),
  };
}

/** HMRC path for a cumulative period summary PUT, by business type. */
export function cumulativePath(nino: string, businessId: string, typeOfBusiness: CumulativeResult['typeOfBusiness'], hmrcTaxYear: string): string {
  if (typeOfBusiness === 'self-employment') {
    return `/individuals/business/self-employment/${nino}/${businessId}/cumulative/${hmrcTaxYear}`;
  }
  const seg = typeOfBusiness === 'foreign-property' ? 'foreign' : 'uk';
  return `/individuals/business/property/${seg}/${nino}/${businessId}/cumulative/${hmrcTaxYear}`;
}

/** API version header value per business type (Self-Employment v5.0, Property v6.0). */
export function cumulativeApiVersion(typeOfBusiness: CumulativeResult['typeOfBusiness']): string {
  return typeOfBusiness === 'self-employment' ? '5.0' : '6.0';
}

/** Our int tax year (2026 = 2026/27) → HMRC 'YYYY-YY' (e.g. '2026-27'). */
export function hmrcTaxYear(taxYearInt: number): string {
  return `${taxYearInt}-${String((taxYearInt + 1) % 100).padStart(2, '0')}`;
}
