// Recurring-transaction date maths — shared by the run endpoint and any UI that
// previews the next occurrence. Pure functions over ISO yyyy-mm-dd strings.

import type { RecurringFrequency } from '@/types/bookkeeping';

/** Parse an ISO yyyy-mm-dd into a UTC date (no timezone drift). */
function parseIso(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function toIso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * The next due date after `from`, advancing by `interval` periods of
 * `frequency`. Month/quarter/year steps are calendar-correct and clamp the day
 * to the end of a shorter target month (e.g. 31 Jan +1 month → 28/29 Feb).
 */
export function advanceDate(fromIso: string, frequency: RecurringFrequency, interval: number): string {
  const n = Math.max(1, Math.floor(interval || 1));
  const d = parseIso(fromIso);

  if (frequency === 'weekly') {
    d.setUTCDate(d.getUTCDate() + 7 * n);
    return toIso(d);
  }

  const monthsToAdd = frequency === 'monthly' ? n : frequency === 'quarterly' ? 3 * n : 12 * n;
  const day = d.getUTCDate();
  // Move to the first of the target month, then clamp the day to that month's length.
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + monthsToAdd, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return toIso(target);
}

/** Whether a schedule has a due occurrence on/before `todayIso`. */
export function isDue(
  nextDueIso: string,
  active: boolean,
  todayIso: string,
  endDateIso: string | null,
  maxOccurrences: number | null = null,
  occurrencesPosted = 0,
): boolean {
  if (!active) return false;
  if (endDateIso && nextDueIso > endDateIso) return false;
  if (maxOccurrences != null && occurrencesPosted >= maxOccurrences) return false;
  return nextDueIso <= todayIso;
}
