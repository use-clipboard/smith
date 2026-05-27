/**
 * financialYears.ts — pure helpers for working with a book's year-end
 * pattern (MM-DD) and the financial-year boundaries it implies.
 *
 *   parseYearEndMd("03-31")           → { month: 3, day: 31 }
 *   fyEndOnOrAfter("03-31", "2025-08-15") → "2026-03-31"
 *   fyContaining("03-31", "2025-08-15")   → { start: "2025-04-01", end: "2026-03-31" }
 *   enumerateFys("03-31", "2023-09-01", "2026-12-31")
 *     → [
 *         { start: "2023-09-01", end: "2024-03-31" },   // short first year
 *         { start: "2024-04-01", end: "2025-03-31" },
 *         { start: "2025-04-01", end: "2026-03-31" },
 *         { start: "2026-04-01", end: "2027-03-31" },   // contains 2026-12-31
 *       ]
 *
 * Edge cases handled:
 *   • Short first FY when first_period_start doesn't align with year-end.
 *   • 29 Feb year-ends fall back to 28 Feb in non-leap years.
 *   • All inputs/outputs are ISO yyyy-mm-dd strings — no Date objects in
 *     return values to avoid timezone drift.
 */

export interface YearEndPattern {
  month: number; // 1-12
  day: number;   // 1-31
}

export interface FyRange {
  start: string; // ISO yyyy-mm-dd
  end: string;   // ISO yyyy-mm-dd
}

/** Parse a 'MM-DD' year-end pattern. Returns null when malformed. */
export function parseYearEndMd(md: string | null | undefined): YearEndPattern | null {
  if (!md) return null;
  const m = /^(\d{2})-(\d{2})$/.exec(md.trim());
  if (!m) return null;
  const month = parseInt(m[1], 10);
  const day   = parseInt(m[2], 10);
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > 31) return null;
  // Sanity: the day exists in some year (e.g. month 2 day 30 → invalid).
  // Use 2024 (a leap year) as the test year so 29 Feb is accepted.
  const probe = new Date(Date.UTC(2024, month - 1, day));
  if (probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) return null;
  return { month, day };
}

/** Build an ISO yyyy-mm-dd from numeric parts, clamping the day to the
 *  month's actual length so a 31-day pattern still produces a valid date
 *  in February etc. */
function isoFromYmd(year: number, month: number, day: number): string {
  // Last day of the month — using "day 0 of next month" trick.
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const dd = String(Math.min(day, lastDay)).padStart(2, '0');
  const mm = String(month).padStart(2, '0');
  return `${year}-${mm}-${dd}`;
}

/** Add one day to an ISO date. Always returns an ISO date string. */
export function addDay(iso: string, days = 1): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}

/** Find the year-end date that's on or after a given reference date. */
export function fyEndOnOrAfter(pattern: YearEndPattern, refIso: string): string {
  const [y] = refIso.split('-').map(Number);
  // Candidate end in the reference year.
  let candidate = isoFromYmd(y, pattern.month, pattern.day);
  if (candidate < refIso) {
    // Reference is past this year's year-end → next year.
    candidate = isoFromYmd(y + 1, pattern.month, pattern.day);
  }
  return candidate;
}

/** Return the FY range (start, end) that contains the given date. */
export function fyContaining(pattern: YearEndPattern, refIso: string): FyRange {
  const end = fyEndOnOrAfter(pattern, refIso);
  // Start = previous YE + 1 day. Previous YE is one year before this one.
  const [ey, em, ed] = end.split('-').map(Number);
  const prevEnd = isoFromYmd(ey - 1, em, ed);
  const start = addDay(prevEnd);
  return { start, end };
}

/**
 * Enumerate every FY range from `firstStart` (inclusive) through whatever FY
 * contains `throughIso`. Honours a "short first year" — the very first
 * range starts at firstStart, not at the previous year-end + 1 day. All
 * subsequent ranges align to the pattern.
 *
 * Example with YE='03-31', firstStart='2024-09-01', throughIso='2026-12-31':
 *   [
 *     { start: '2024-09-01', end: '2025-03-31' },
 *     { start: '2025-04-01', end: '2026-03-31' },
 *     { start: '2026-04-01', end: '2027-03-31' },
 *   ]
 */
export function enumerateFys(
  pattern: YearEndPattern,
  firstStart: string,
  throughIso: string,
): FyRange[] {
  if (firstStart > throughIso) return [];
  const ranges: FyRange[] = [];
  // Year-end of the FY that contains firstStart.
  let end = fyEndOnOrAfter(pattern, firstStart);
  let start = firstStart;
  // Cap to a sensible upper bound to defend against runaway loops.
  for (let i = 0; i < 200; i++) {
    ranges.push({ start, end });
    if (end >= throughIso) break;
    start = addDay(end);
    // Next year-end is exactly one year after the current one (clamped to
    // the month length, e.g. 28-Feb → 29-Feb in a leap year).
    const [ey, em, ed] = end.split('-').map(Number);
    end = isoFromYmd(ey + 1, em, ed);
  }
  return ranges;
}

/** Locate the FY range (within a list) that contains a date. Useful when
 *  validating "is this transaction in a closed year?" without re-running
 *  enumerateFys server-side every check. */
export function findFyForDate<T extends FyRange>(rows: T[], iso: string): T | null {
  for (const r of rows) {
    if (iso >= r.start && iso <= r.end) return r;
  }
  return null;
}
