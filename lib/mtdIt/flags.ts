// MTD IT — flag helpers used by the review editor.
//
// A row can be flagged from three places, and the difference matters:
//
//   flagged_reason  — Claude's flag from analyse, or a reviewer's manual flag.
//                     PERSISTED. Only a human clears it.
//   _autoFlag       — derived from the rows themselves (out-of-range date,
//                     possible duplicate). NEVER persisted; recomputed from
//                     scratch on every pass so it clears the moment the user
//                     fixes the problem.
//
// They used to share one field, which made auto-flags permanent: the old code
// short-circuited on `if (e.flagged_reason) return e`, so a date typed
// character-by-character would flag as out-of-range on the partial year, and
// then never un-flag once the year was finished. Flagged rows are excluded from
// the totals, so a correct entry silently vanished from the quarter's income.
//
// Keep this module pure and dependency-free — computeUpdate runs it server-side
// to exclude the same rows the reviewer saw excluded.

import type { MtdItStream } from '@/types';

/** Minimum shape applyAutoFlags needs. `id` isn't required — flagging is keyed
 *  on row contents (date + supplier + amount), so manual rows that haven't been
 *  inserted yet are flagged just the same. */
export interface FlaggableEntry {
  stream: MtdItStream;
  entry_date: string | null;
  supplier: string | null;
  gross_amount: number | null;
  flagged_reason: string | null;
  /** Set true by the user to silence flagging on this row. */
  flag_dismissed?: boolean | null;
  /** Derived, editor-only. Written by applyAutoFlags; never saved. */
  _autoFlag?: string | null;
}

/** Earliest date we'll treat as a real entry rather than half-typed input.
 *  A native <input type="date"> emits a complete ISO string as soon as all
 *  three segments are non-empty, so typing "2025" into the year produces
 *  0002 → 0020 → 0202 → 2025. Without this guard the first three flag the row
 *  as out-of-range mid-keystroke. */
const MIN_PLAUSIBLE_DATE = '1900-01-01';

/** Is this ISO date outside (from, to)? Empty and implausible dates are not
 *  "out of range" — they're "not finished being typed". */
function isOutOfRange(date: string | null, from: string, to: string): boolean {
  if (!date) return false;
  if (date < MIN_PLAUSIBLE_DATE) return false;
  return date < from || date > to;
}

/** True if `reason` is an auto-flag string that an older build persisted into
 *  the DB, and which should now be recomputed rather than treated as a human's
 *  flag.
 *
 *  Two authors produced these:
 *    - prompts/mtd-it.ts asked Claude for the bare string (the common case —
 *      163 of 164 flagged rows on live at the time of writing);
 *    - an earlier applyAutoFlags appended the range it checked against.
 *
 *  Without this, those rows read as permanent human flags: excluded from the
 *  totals and the filing, with no code path able to clear them. Matching is
 *  deliberately narrow so a reviewer's own note is never silently dropped.
 *  Delete once no stored flagged_reason matches. */
export function isLegacyAutoFlag(reason: string | null | undefined): boolean {
  if (!reason) return false;
  return reason === 'Outside quarter date range'
      || reason.startsWith('Outside quarter date range (')
      || reason === 'Possible duplicate (same date, supplier and amount)';
}

/** The flag to show for a row, or null if it's clean. */
export function flagReasonFor(e: FlaggableEntry): string | null {
  if (e.flag_dismissed) return null;
  return e.flagged_reason ?? e._autoFlag ?? null;
}

/** Is this row flagged (and therefore excluded from totals and the filing)? */
export function isEntryFlagged(e: FlaggableEntry): boolean {
  return flagReasonFor(e) !== null;
}

/**
 * Prepare rows loaded straight from the DB for flag checks: drop legacy
 * auto-flag strings that an older build persisted, then derive the flags fresh.
 *
 * Server paths must call this before testing isEntryFlagged(), so the rows they
 * exclude are exactly the rows the reviewer saw excluded. Reading the stored
 * `flagged_reason` alone would both miss newly out-of-range rows and honour
 * stale ones.
 */
export function reflagStoredRows<T extends FlaggableEntry>(
  rows: T[],
  fromIso: string,
  toIso: string,
): T[] {
  const cleaned = rows.map(r =>
    isLegacyAutoFlag(r.flagged_reason) ? ({ ...r, flagged_reason: null } as T) : r,
  );
  return applyAutoFlags(cleaned, fromIso, toIso);
}

/**
 * Recompute `_autoFlag` for every entry against the supplied date range.
 * Pure — returns a new array, doesn't mutate the input.
 *
 * Runs on every keystroke, so it must be cheap and must never latch: the whole
 * point is that fixing the row clears the flag without a reload.
 *
 * Precedence, once combined by flagReasonFor(): a human's flag (Claude's or the
 * reviewer's) wins over a derived one; out-of-range wins over duplicate.
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
    let auto: string | null = null;
    if (isOutOfRange(e.entry_date, fromIso, toIso)) {
      auto = `Outside quarter date range (${fromIso} – ${toIso})`;
    } else if (e.entry_date && e.supplier && e.gross_amount !== null && e.gross_amount !== undefined) {
      if ((counts.get(dupKey(e)) ?? 0) > 1) {
        auto = 'Possible duplicate (same date, supplier and amount)';
      }
    }
    // Spreads widen T → FlaggableEntry in TS's view, so cast back to T to
    // preserve the caller's row type (EditorEntry in the review editor).
    if (auto === (e._autoFlag ?? null)) return e; // unchanged — keep identity
    return { ...e, _autoFlag: auto } as T;
  });
}
