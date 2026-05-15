// MTD IT mandation thresholds, keyed by the starting year of the tax year.
//
//   2026/27 → £50,000 qualifying income
//   2027/28 → £30,000 qualifying income
//   2028/29 → £20,000 qualifying income (announced; included for forward planning)
//
// Used to flag clients whose latest known income looks below the threshold for
// the selected tax year — i.e. they may not actually be MTD-mandated yet.

export const MTD_IT_THRESHOLDS: Record<number, number> = {
  2026: 50_000,
  2027: 30_000,
  2028: 20_000,
  2029: 20_000,
  2030: 20_000,
};

export function thresholdForYear(taxYear: number): number {
  if (taxYear in MTD_IT_THRESHOLDS) return MTD_IT_THRESHOLDS[taxYear];
  // Default to most recent known threshold for years beyond the table
  const years = Object.keys(MTD_IT_THRESHOLDS).map(Number).sort((a, b) => a - b);
  const latest = years[years.length - 1];
  return MTD_IT_THRESHOLDS[latest];
}

export interface ThresholdFlag {
  /** True when the client's prior-year income looks below the threshold for the year */
  belowThreshold: boolean;
  /** Distance to threshold (negative = below). null when prior-year income is unknown. */
  delta: number | null;
  threshold: number;
}

export function evaluateThreshold(
  priorYearIncome: number | null,
  taxYear: number,
): ThresholdFlag {
  const threshold = thresholdForYear(taxYear);
  if (priorYearIncome === null || priorYearIncome === undefined) {
    return { belowThreshold: false, delta: null, threshold };
  }
  return {
    belowThreshold: priorYearIncome < threshold,
    delta: priorYearIncome - threshold,
    threshold,
  };
}
