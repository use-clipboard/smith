// ──────────────────────────────────────────────────────────────────────────
//  Bookkeeping — bank-rec duplicate detection.
// ──────────────────────────────────────────────────────────────────────────
//
//  Shared helper used by both CSV contribute-lines AND the multi-row
//  manual sheet to flag suspected duplicates before they hit the ledger.
//
//  Match definition (loose enough to catch real dupes, tight enough not
//  to drown the user in noise):
//    • Same bank account (always — passed in by caller)
//    • Signed amount equal within £0.005
//        (debit - credit on the existing split, signed amount on the
//         candidate — money-in = positive, money-out = negative)
//    • Transaction date within ±3 days
//
//  We return the BEST match per candidate (closest by date). null means
//  no probable duplicate found.

import { createClient } from '@/lib/supabase-server';

type SupabaseClient = ReturnType<typeof createClient>;

export interface DuplicateCandidateInput {
  /** YYYY-MM-DD */
  date:   string;
  /** Signed (positive = money INTO the bank account). */
  amount: number;
}

export interface DuplicateMatch {
  split_id:      string;
  transaction_id: string;
  ref_no:         string;
  date:           string;
  signed_amount:  number;
  details:        string | null;
  type:           string;
}

export interface DuplicateResult {
  /** Position in the input array. */
  index: number;
  /** null when no probable dupe was found. */
  match: DuplicateMatch | null;
}

/** ±days from an ISO date. */
function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Scan a batch of candidates against the existing ledger on this account.
 * Two-query approach: transactions first (date-bounded), splits second
 * (constrained to those transaction IDs). Avoids PostgREST's brittle
 * embed-filter forms entirely.
 */
export async function detectDuplicateLines(
  supabase: SupabaseClient,
  bookId: string,
  accountId: string,
  candidates: DuplicateCandidateInput[],
): Promise<DuplicateResult[]> {
  if (candidates.length === 0) return [];

  // Compute a date window that covers every candidate ±3 days.
  const sortedDates = candidates.map(c => c.date).sort();
  const windowFrom  = addDays(sortedDates[0], -3);
  const windowTo    = addDays(sortedDates[sortedDates.length - 1], 3);

  // Q1: transactions in the window. Paginated — a 12-month CSV against
  // a busy book can hit >1000 transactions across the window and Supabase
  // would silently truncate, letting actual duplicates slip through.
  const PAGE = 1000;
  type TxnRow = { id: string; ref_no: string; date: string; details: string | null; type: string };
  const txns: TxnRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data: batch } = await supabase
      .from('bookkeeping_transactions')
      .select('id, ref_no, date, details, type')
      .eq('book_id', bookId)
      .gte('date', windowFrom)
      .lte('date', windowTo)
      .range(from, from + PAGE - 1);
    const rows = (batch ?? []) as TxnRow[];
    txns.push(...rows);
    if (rows.length < PAGE) break;
  }

  if (txns.length === 0) {
    return candidates.map((_, i) => ({ index: i, match: null }));
  }
  const txnById = new Map(txns.map(t => [t.id, t]));

  // Q2: splits on THIS account belonging to those transactions. Same
  // pagination story — many transactions in the window means many splits.
  // Vercel/Cloudflare edge layers in front of Supabase enforce a ~8 KB
  // URL-length cap, so .in() chunks need to stay well below that. 200
  // UUIDs ≈ 7.4 KB, the same chunk size used by clear-splits / unclear-
  // splits and the entries endpoint.
  const TXN_CHUNK = 200;
  type SplitRow = { id: string; transaction_id: string; debit: number; credit: number };
  const splits: SplitRow[] = [];
  for (let i = 0; i < txns.length; i += TXN_CHUNK) {
    const chunkIds = txns.slice(i, i + TXN_CHUNK).map(t => t.id);
    for (let from = 0; ; from += PAGE) {
      const { data: batch } = await supabase
        .from('bookkeeping_transaction_splits')
        .select('id, transaction_id, debit, credit')
        .eq('account_id', accountId)
        .in('transaction_id', chunkIds)
        .range(from, from + PAGE - 1);
      const rows = (batch ?? []) as SplitRow[];
      splits.push(...rows);
      if (rows.length < PAGE) break;
    }
  }

  // For each candidate, find the closest-by-date split with matching
  // signed amount. We use a small in-memory scan rather than an indexed
  // SQL query because the candidate count is bounded (≤ a few hundred CSV
  // rows or ≤ 200 sheet rows) and the splits-in-window count is similarly
  // bounded.
  const results: DuplicateResult[] = [];
  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i];
    const cTime = new Date(c.date).getTime();
    let bestMatch: DuplicateMatch | null = null;
    let bestDiff = Infinity;
    for (const s of splits ?? []) {
      const splitSigned = Number(s.debit) - Number(s.credit);
      if (Math.abs(splitSigned - c.amount) > 0.005) continue;
      const txn = txnById.get(s.transaction_id);
      if (!txn) continue;
      const dDays = Math.abs(new Date(txn.date).getTime() - cTime) / (1000 * 60 * 60 * 24);
      if (dDays > 3) continue;
      if (dDays < bestDiff) {
        bestDiff = dDays;
        bestMatch = {
          split_id:       s.id,
          transaction_id: s.transaction_id,
          ref_no:         txn.ref_no,
          date:           txn.date,
          signed_amount:  Math.round(splitSigned * 100) / 100,
          details:        txn.details,
          type:           txn.type,
        };
      }
    }
    results.push({ index: i, match: bestMatch });
  }
  return results;
}
