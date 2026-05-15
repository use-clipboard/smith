// MTD IT — flag helpers used by the review editor.
//
// Two automatic flags are applied client-side when the review screen loads:
//   1. Out-of-range — entry_date is outside the quarter's date window
//   2. Possible duplicate — same date + amount + supplier within the
//      same stream
//
// These run on the in-memory editor state, NOT on the DB rows, because the
// user may be in the middle of editing dates / amounts and we want the flag
// to update live. The flag string is shown in the row's Flag column and can
// be dismissed (cleared) per row.

// Minimum shape applyAutoFlags needs. `id` isn't required — flagging is keyed
// on row contents (date + supplier + amount), so manual rows that haven't been
// inserted yet are flagged just the same.
export interface FlaggableEntry {
  stream: 'sole' | 'uk_rental' | 'foreign_rental';
  entry_date: string | null;
  supplier: string | null;
  gross_amount: number | null;
  flagged_reason: string | null;
  /** Set true by the user to silence auto-flagging on this row. */
  flag_dismissed?: boolean;
}

/** Returns YYYY-MM-DD outside (from, to)? */
function isOutOfRange(date: string | null, from: string, to: string): boolean {
  if (!date) return false; // missing dates are flagged elsewhere
  return date < from || date > to;
}

/**
 * Re-compute flagged_reason for every entry against the supplied date range.
 * Pure — returns a new array, doesn't mutate the input.
 *
 * Precedence (first match wins):
 *   - Existing flagged_reason from Claude (if user hasn't dismissed)
 *   - Out-of-range
 *   - Possible duplicate of another row
 */
export function applyAutoFlags<T extends FlaggableEntry>(
  entries: T[],
  fromIso: string,
  toIso: string,
): T[] {
  // Group by (stream, date, supplier normalised, |amount| rounded to 2dp)
  // for fast duplicate lookup.
  const dupKey = (e: T) =>
    `${e.stream}|${e.entry_date ?? ''}|${(e.supplier ?? '').trim().toLowerCase()}|${Math.round((e.gross_amount ?? 0) * 100) / 100}`;
  const counts = new Map<string, number>();
  for (const e of entries) {
    if (!e.entry_date || !e.supplier || e.gross_amount === null || e.gross_amount === undefined) continue;
    const k = dupKey(e);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }

  return entries.map(e => {
    // Spreads widen T → FlaggableEntry in TS's view, so cast back to T to
    // preserve the caller's row type (EditorEntry in the review editor).
    if (e.flag_dismissed) return { ...e, flagged_reason: null } as T;
    if (e.flagged_reason) return e;

    if (isOutOfRange(e.entry_date, fromIso, toIso)) {
      return { ...e, flagged_reason: `Outside quarter date range (${fromIso} – ${toIso})` } as T;
    }
    if (e.entry_date && e.supplier && e.gross_amount !== null && e.gross_amount !== undefined) {
      const k = dupKey(e);
      if ((counts.get(k) ?? 0) > 1) {
        return { ...e, flagged_reason: 'Possible duplicate (same date, supplier and amount)' } as T;
      }
    }
    return e;
  });
}
