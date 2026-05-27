/**
 * checkRecLock — client-side helper that asks the server whether a set of
 * (account_id, date) pairs falls inside any RECONCILED bank rec.
 *
 * Used by every transaction input sheet (PAY / REC / JRN / etc) right
 * before posting. The result drives the warning lightbox: if any locks
 * come back, we surface them and require the user to explicitly choose
 * "Post anyway" before sending the real POST /transactions.
 *
 * Why client-side?
 *   The POST /transactions endpoint currently DOESN'T hard-block postings
 *   into a reconciled period (only PATCH/DELETE do — once a split is
 *   cleared). That's deliberate: a fresh posting into a closed period is
 *   sometimes legitimate (a forgotten invoice that the user accepts will
 *   blow the rec total). We want a warning, not a wall — so the gate
 *   lives in the UI.
 *
 *   In-progress recs DON'T trigger the warning (the period isn't closed
 *   yet). Only `status='reconciled'` does. See the matching server route
 *   (/bank-imports/posting-warning) for the SQL.
 *
 * Caller passes a list of probes (typically one per line of the input
 * sheet). Pairs are de-duped before we hit the network — a 10-line journal
 * that touches the same bank account on the same date only makes one call.
 *
 * Returns an array of locks (empty when everything's clear). Each lock
 * carries the original probe + the rec metadata so the modal can show
 * "Bank: Current account · 01/04/24 → 31/03/25" alongside the user's row.
 */

export interface RecLockProbe {
  /** Account being posted to. The endpoint just compares this against
   *  the recs' account_id, so non-bank accounts return `locked:false`
   *  cheaply — we don't pre-filter to "bank ledger only" here. */
  accountId: string;
  /** YYYY-MM-DD transaction date. */
  date: string;
  /** Optional display name passed straight through into the lock result.
   *  Lets the warning modal show "Bank: Current account" without making
   *  the caller re-resolve the name from the account list. */
  accountName?: string;
}

export interface RecLockHit {
  probe: RecLockProbe;
  rec: {
    id: string;
    label: string;
    period_start: string | null;
    period_end:   string | null;
    reconciled_at: string | null;
  };
}

/** De-dupe key for (accountId, date). */
function probeKey(p: RecLockProbe): string {
  return `${p.accountId}|${p.date}`;
}

export async function checkRecLock(
  bookId: string,
  probes: RecLockProbe[],
): Promise<RecLockHit[]> {
  if (probes.length === 0) return [];

  // De-dupe — input sheets routinely re-probe the same account/date
  // (e.g. PAY rows posted in a batch all share one date). Keep the first
  // occurrence of each pair so the accountName label is preserved.
  const seen = new Map<string, RecLockProbe>();
  for (const p of probes) {
    const k = probeKey(p);
    if (!seen.has(k)) seen.set(k, p);
  }
  const unique = [...seen.values()];

  // Fire all warning checks in parallel. The endpoint is a single indexed
  // SQL lookup; even 20 of them in flight at once is cheap. We swallow
  // network errors silently — a failed warning check should NOT block the
  // post (the user can still hit "Post anyway" mentally even without the
  // dialog). Worst case they post into a locked period and the server
  // accepts it; right now that's the existing default behaviour anyway.
  const results = await Promise.allSettled(
    unique.map(async p => {
      const r = await fetch(
        `/api/bookkeeping/books/${bookId}/bank-imports/posting-warning?account_id=${encodeURIComponent(p.accountId)}&date=${encodeURIComponent(p.date)}`,
      );
      if (!r.ok) return null;
      const d = await r.json() as
        | { locked: false }
        | { locked: true; rec: RecLockHit['rec'] };
      if (!d.locked) return null;
      return { probe: p, rec: d.rec } satisfies RecLockHit;
    }),
  );

  const hits: RecLockHit[] = [];
  for (const r of results) {
    if (r.status === 'fulfilled' && r.value) hits.push(r.value);
  }
  return hits;
}
