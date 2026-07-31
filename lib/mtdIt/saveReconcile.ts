// MTD IT — folding a completed save back into the editor state.
//
// Pulled out of the review component because getting this wrong is expensive in
// both directions: leave `_isNew` set and the next save re-inserts every row as
// a duplicate; clear `_dirty` too eagerly and you discard edits the user made
// while the request was in flight. Autosave fires this every couple of seconds,
// so both failure modes would be constant rather than rare.
//
// History / why this looks the way it does:
//   The first version matched rows to the request by *object reference* — "a row
//   that is !== its saved counterpart was touched mid-flight, keep it dirty".
//   That was too brittle. Editor state carries a derived `_autoFlag` field, and
//   editing ONE row can flip the duplicate/out-of-range flag of ANOTHER row,
//   which rebuilds that other row's object (see lib/mtdIt/flags applyAutoFlags).
//   The reconciler then read the untouched row as "edited mid-flight", never
//   cleared its `_isNew`, and the next save re-inserted it as a duplicate — a
//   transaction appearing twice, or (once ids were mis-attached) the wrong DB
//   row being overwritten/deleted. Both are the "rows vanish at random" report.
//
//   It also assumed the server returned created ids in input order, which
//   Postgres does not guarantee — a mis-ordered id stamped the wrong DB id onto
//   a new row, so a later edit/delete hit someone else's record.
//
// Both problems are gone now: new rows own a client-generated UUID from birth
// (emptyEntry), so there's no id to attach and no ordering to depend on, and
// "was this edited mid-flight?" is decided by comparing the PERSISTED fields
// only — the derived `_autoFlag`/`_dateText` churn is ignored.

import type { EditorEntry } from './types';

// The columns that actually persist to mtd_it_entries. Editor-only fields
// (anything prefixed `_`) are deliberately excluded: their churn must never be
// mistaken for a user edit. `flag_dismissed` IS persisted (its own column).
const PERSISTED_KEYS = [
  'id', 'stream', 'trade_id', 'property_id', 'source_file_name', 'page_number',
  'entry_date', 'description', 'supplier', 'invoice_number', 'category',
  'entry_type', 'gross_amount', 'net_amount', 'vat_amount', 'currency',
  'fx_rate', 'gbp_amount', 'share_pct', 'manual', 'flagged_reason',
  'flag_dismissed', 'drive_link',
] as const;

/** True if two rows carry identical persisted content — i.e. the row now in the
 *  editor hasn't been meaningfully changed since it was serialised into the
 *  save. Undefined and null compare equal so an absent optional doesn't read as
 *  a change. */
function persistedEqual(a: EditorEntry, b: EditorEntry): boolean {
  const ar = a as unknown as Record<string, unknown>;
  const br = b as unknown as Record<string, unknown>;
  return PERSISTED_KEYS.every(k => (ar[k] ?? null) === (br[k] ?? null));
}

/**
 * Apply the outcome of a save to the current editor rows.
 *
 * @param current The rows as they are NOW (the user may have typed since the
 *                request went out).
 * @param saved   The exact array that was serialised into the request.
 *
 * Rows are matched to the request by `_localId` (stable for the whole session).
 * A matched row is considered persisted, so its `_isNew` clears; its `_dirty`
 * clears only if the persisted content is unchanged since `saved` — otherwise
 * the user edited it mid-flight and it stays dirty for the next save. Because
 * every new row already holds its final `id`, a mid-flight-edited new row simply
 * becomes an UPDATE next time round rather than a second INSERT.
 */
export function applySaveResult(
  current: EditorEntry[],
  saved: EditorEntry[],
): EditorEntry[] {
  const savedByLocalId = new Map(saved.map(e => [e._localId, e]));

  return current.flatMap(e => {
    const asSaved = savedByLocalId.get(e._localId);
    if (!asSaved) return [e];        // added after the request went out
    if (asSaved._deleted) return []; // it was in `deletes` — gone from the DB now
    if (e._deleted) {
      // Deleted after the request went out, so it wasn't in this save's
      // `deletes`. If the same save CREATED it (asSaved was new), it now exists
      // in the DB — clear `_isNew` so the next save's delete picks it up rather
      // than skipping it as a never-persisted row and orphaning it. Keep
      // `_deleted` either way so the next save removes it.
      return asSaved._isNew ? [{ ...e, _isNew: false }] : [e];
    }
    const editedMidFlight = !persistedEqual(e, asSaved);
    return [{ ...e, _isNew: false, _dirty: editedMidFlight }];
  });
}
