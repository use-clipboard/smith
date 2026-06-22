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
      return {
        countryCode: c.countryCode,
        income: { rentIncome: { rentAmount: round2(c.income) } },
        expenses,
      };
    }),
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
