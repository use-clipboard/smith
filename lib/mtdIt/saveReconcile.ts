// MTD IT — folding a completed save back into the editor state.
//
// Pulled out of the review component because getting this wrong is expensive in
// both directions: leave `_isNew` set and the next save re-inserts every row as
// a duplicate; clear `_dirty` too eagerly and you discard edits the user made
// while the request was in flight. Autosave fires this every couple of seconds,
// so both failure modes would be constant rather than rare.

import type { EditorEntry } from './types';

/**
 * Apply the outcome of a save to the current editor rows.
 *
 * @param current    Rows as they are NOW (the user may have typed since).
 * @param saved      The exact array that was serialised into the request.
 * @param createdIds Ids the server minted, in the same order as the `creates`
 *                   it was sent — i.e. `saved.filter(_isNew && !_deleted)`.
 *
 * Rows are matched to the request by reference. Editor state is immutable (each
 * patch builds a new object), so a row that is `!==` its saved counterpart was
 * touched mid-flight and keeps its flags for the next save.
 */
export function applySaveResult(
  current: EditorEntry[],
  saved: EditorEntry[],
  createdIds: string[],
): EditorEntry[] {
  const idFor = new Map<string, string>();
  saved.filter(e => e._isNew && !e._deleted).forEach((e, i) => {
    const id = createdIds[i];
    if (id) idFor.set(e._localId, id);
  });
  const savedByLocalId = new Map(saved.map(e => [e._localId, e]));

  return current.flatMap(e => {
    const asSaved = savedByLocalId.get(e._localId);
    if (!asSaved) return [e];        // added after the request went out
    if (asSaved !== e) return [e];   // edited mid-flight — still dirty
    if (e._deleted) return [];       // gone from the DB now
    const newId = idFor.get(e._localId);
    // A new row with no id back from the server stays _isNew, so the next save
    // retries the insert rather than issuing an update against nothing.
    if (e._isNew && !newId) return [e];
    return [{ ...e, ...(newId ? { id: newId } : {}), _isNew: false, _dirty: false }];
  });
}
