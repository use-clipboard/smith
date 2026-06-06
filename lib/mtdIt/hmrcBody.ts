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
