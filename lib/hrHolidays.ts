/**
 * Helpers for holiday calculations.
 *
 * Convention: a single full day is 1.0; a half-day is 0.5.
 * Multi-day spans count weekend days too (firms can adjust later if needed).
 */

export type HalfMarker = 'full' | 'morning' | 'afternoon';

export function calcTotalDays(
  startDate: string,
  startHalf: HalfMarker,
  endDate: string,
  endHalf: HalfMarker,
): number {
  // Parse to UTC noon to avoid timezone edge cases.
  const a = new Date(startDate + 'T12:00:00Z').getTime();
  const b = new Date(endDate + 'T12:00:00Z').getTime();
  const dayMs = 24 * 60 * 60 * 1000;
  const inclusiveDays = Math.round((b - a) / dayMs) + 1;
  if (inclusiveDays <= 0) return 0;

  if (inclusiveDays === 1) {
    // Single day. If start_half is 'full', it's a full day. If start_half is
    // 'morning' or 'afternoon', it's a half day.
    return startHalf === 'full' ? 1 : 0.5;
  }

  // Multi-day span. Each end is full unless flagged as a half.
  let total = inclusiveDays;
  if (startHalf !== 'full') total -= 0.5;
  if (endHalf !== 'full') total -= 0.5;
  return total;
}

/** Compute the holiday-year window that includes today. */
export function holidayYearWindow(
  resetMonth: number,
  resetDay: number,
  reference: Date = new Date(),
): { start: Date; end: Date } {
  const y = reference.getUTCFullYear();
  // Build the candidate "this year's" reset.
  const thisYearReset = new Date(Date.UTC(y, resetMonth - 1, resetDay));
  if (reference.getTime() >= thisYearReset.getTime()) {
    // After this year's reset → window is [this year's reset .. next year's reset)
    const nextReset = new Date(Date.UTC(y + 1, resetMonth - 1, resetDay));
    return { start: thisYearReset, end: nextReset };
  } else {
    // Before this year's reset → window is [last year's reset .. this year's reset)
    const lastReset = new Date(Date.UTC(y - 1, resetMonth - 1, resetDay));
    return { start: lastReset, end: thisYearReset };
  }
}

export function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}
