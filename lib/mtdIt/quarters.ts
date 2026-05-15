// Quarter date helpers for MTD IT.
//
// A "tax year" is identified by the starting calendar year — e.g. 2026 means
// the 2026/27 UK tax year, which runs 6 Apr 2026 → 5 Apr 2027.
//
// HMRC offers two quarter election types:
//   - 'calendar': 1 Apr–30 Jun, 1 Jul–30 Sep, 1 Oct–31 Dec, 1 Jan–31 Mar
//   - 'standard': 6 Apr–5 Jul, 6 Jul–5 Oct, 6 Oct–5 Jan, 6 Jan–5 Apr
//
// Quarter numbers (1..4) are 1-indexed and ordered chronologically.

import type { MtdItQuarterType } from '@/types';

export interface QuarterRange {
  quarter: 1 | 2 | 3 | 4;
  /** ISO date YYYY-MM-DD (inclusive) */
  from: string;
  /** ISO date YYYY-MM-DD (inclusive) */
  to: string;
  /** Short month-range label, e.g. "Apr – Jun" */
  monthsLabel: string;
}

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function iso(y: number, m1to12: number, d: number): string {
  return `${y}-${String(m1to12).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
}

export function getQuarterDates(
  taxYear: number,
  quarter: 1 | 2 | 3 | 4,
  type: MtdItQuarterType,
): QuarterRange {
  if (type === 'calendar') {
    // Q1: Apr–Jun (taxYear), Q2: Jul–Sep (taxYear), Q3: Oct–Dec (taxYear), Q4: Jan–Mar (taxYear+1)
    const startMonth = quarter === 1 ? 4 : quarter === 2 ? 7 : quarter === 3 ? 10 : 1;
    const endMonth   = quarter === 1 ? 6 : quarter === 2 ? 9 : quarter === 3 ? 12 : 3;
    const startYear  = quarter === 4 ? taxYear + 1 : taxYear;
    const endYear    = quarter === 4 ? taxYear + 1 : taxYear;
    const lastDay    = lastDayOfMonth(endYear, endMonth);
    return {
      quarter,
      from: iso(startYear, startMonth, 1),
      to:   iso(endYear,   endMonth,   lastDay),
      monthsLabel: `${MONTHS[startMonth - 1]} – ${MONTHS[endMonth - 1]}`,
    };
  }
  // 'standard' — 5th-of-the-month boundaries aligned to the UK tax year
  // Q1: 6 Apr – 5 Jul (taxYear), Q2: 6 Jul – 5 Oct (taxYear),
  // Q3: 6 Oct (taxYear) – 5 Jan (taxYear+1), Q4: 6 Jan – 5 Apr (taxYear+1)
  const ranges: Record<1|2|3|4, { from: [number, number, number]; to: [number, number, number]; label: string }> = {
    1: { from: [taxYear,     4,  6], to: [taxYear,     7,  5], label: 'Apr – Jul' },
    2: { from: [taxYear,     7,  6], to: [taxYear,    10,  5], label: 'Jul – Oct' },
    3: { from: [taxYear,    10,  6], to: [taxYear + 1, 1,  5], label: 'Oct – Jan' },
    4: { from: [taxYear + 1, 1,  6], to: [taxYear + 1, 4,  5], label: 'Jan – Apr' },
  };
  const r = ranges[quarter];
  return {
    quarter,
    from: iso(r.from[0], r.from[1], r.from[2]),
    to:   iso(r.to[0],   r.to[1],   r.to[2]),
    monthsLabel: r.label,
  };
}

export function getQuartersForYear(taxYear: number, type: MtdItQuarterType): QuarterRange[] {
  return [1, 2, 3, 4].map(q => getQuarterDates(taxYear, q as 1|2|3|4, type));
}

function lastDayOfMonth(year: number, month1to12: number): number {
  // Day 0 of the next month = last day of this month
  return new Date(year, month1to12, 0).getDate();
}

/**
 * Tax year label, e.g. taxYear=2026 → "2026/27".
 */
export function taxYearLabel(taxYear: number): string {
  const next = (taxYear + 1) % 100;
  return `${taxYear}/${String(next).padStart(2, '0')}`;
}

/**
 * The current UK tax year (starting year). The UK tax year begins 6 April.
 * MTD IT mandates from 2026/27, so this floors at 2026.
 */
export function currentTaxYear(now: Date = new Date()): number {
  const y = now.getFullYear();
  const month = now.getMonth() + 1;
  const day   = now.getDate();
  const startedThisCalendarYear = (month > 4) || (month === 4 && day >= 6);
  const year = startedThisCalendarYear ? y : y - 1;
  return Math.max(2026, year);
}

/**
 * Returns a small set of selectable tax years for the dashboard dropdown.
 * Currently: the 2026/27 year + the next 4 years.
 */
export function selectableTaxYears(now: Date = new Date()): number[] {
  const base = currentTaxYear(now);
  const out: number[] = [];
  for (let i = 0; i < 5; i++) out.push(base + i);
  return out;
}
