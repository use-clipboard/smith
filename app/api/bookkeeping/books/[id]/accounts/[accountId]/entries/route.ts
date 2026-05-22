import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { getBookkeepingContext } from '@/lib/bookkeeping/server';

// ── GET /api/bookkeeping/books/[id]/accounts/[accountId]/entries ─────────────
// All splits that touch this account, returned as one row per split with the
// owning transaction's header data + the split's match status.
//
// Query params:
//   ?date_from=YYYY-MM-DD
//   ?date_to=YYYY-MM-DD
//   ?status=open|all   (default: all)  — open = unmatched splits only
//   ?include_running=true (default true) — compute a running balance column
//
// Response shape:
//   {
//     account: { id, name, ledger, account_type, opening_balance, closing_balance },
//     entries: [
//       {
//         split_id, transaction_id, ref_no, date, details, due_date,
//         debit, credit, running_balance,
//         match_id, match_status     // null when unmatched
//       }
//     ]
//   }

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string; accountId: string } },
) {
  const ctx = await getBookkeepingContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const url = new URL(req.url);
  const dateFrom = url.searchParams.get('date_from');
  const dateTo   = url.searchParams.get('date_to');
  const statusFilter = url.searchParams.get('status') ?? 'all';

  const supabase = createClient();
  // Confirm book + account are in this firm
  const { data: account, error: accErr } = await supabase
    .from('bookkeeping_accounts')
    .select(`
      id, name, ledger, account_type,
      book:bookkeeping_books!inner(id, firm_id)
    `)
    .eq('id', params.accountId)
    .eq('book_id', params.id)
    .single();
  if (accErr || !account) return NextResponse.json({ error: 'Account not found' }, { status: 404 });
  // @ts-expect-error — the joined book is always there because of !inner
  if (account.book.firm_id !== ctx.firmId) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // Pull every split touching this account, joined to its parent transaction
  // and (optionally) its match. Need everything up to date_to so we can
  // compute the opening balance from history prior to date_from.
  // PostgREST returns the embedded `match_line` as an array because the FK
  // direction is many-to-one (many lines could in theory point at this split,
  // even though our UNIQUE constraint guarantees at most one). The nested
  // `match` join is many-to-one from match_lines to matches, so that one
  // comes back as a single object.
  type SplitRow = {
    id: string;
    transaction_id: string;
    debit: number;
    credit: number;
    transaction: {
      id: string;
      ref_no: string;
      date: string;
      details: string | null;
      book_id: string;
    } | null;
    match_line: Array<{
      match_id: string;
      match: { id: string; status: 'full' | 'partial' | 'write_off' } | null;
    }>;
  };

  // The match join goes through bookkeeping_match_lines → bookkeeping_matches.
  // A split can only be in at most one match (UNIQUE constraint on match_lines).
  const { data, error } = await supabase
    .from('bookkeeping_transaction_splits')
    .select(`
      id, transaction_id, debit, credit,
      transaction:bookkeeping_transactions!inner(id, ref_no, date, details, book_id),
      match_line:bookkeeping_match_lines(match_id, match:bookkeeping_matches(id, status))
    `)
    .eq('account_id', params.accountId)
    .eq('transaction.book_id', params.id)
    .order('date', { ascending: true, referencedTable: 'bookkeeping_transactions' })
    .order('ref_seq', { ascending: true, referencedTable: 'bookkeeping_transactions' });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rows = (data ?? []) as unknown as SplitRow[];

  // Walk chronologically, computing the running balance and bucketing into
  // "before from", "in period", "after to". For first version we don't have
  // a due_date column — return null and we'll add it later if needed.
  type Entry = {
    split_id: string;
    transaction_id: string;
    ref_no: string;
    date: string;
    details: string | null;
    due_date: string | null;
    debit: number;
    credit: number;
    running_balance: number;
    match_id: string | null;
    match_status: 'full' | 'partial' | 'write_off' | null;
  };

  let runningBalance = 0;
  let openingBalance = 0;
  let closingBalance = 0;
  const entries: Entry[] = [];

  for (const r of rows) {
    if (!r.transaction) continue;
    const debit  = Number(r.debit);
    const credit = Number(r.credit);
    runningBalance = +(runningBalance + debit - credit).toFixed(2);

    if (dateFrom && r.transaction.date < dateFrom) {
      openingBalance = runningBalance;
      continue;
    }
    if (dateTo && r.transaction.date > dateTo) {
      continue;
    }

    const matchLine = r.match_line && r.match_line.length > 0 ? r.match_line[0] : null;
    entries.push({
      split_id: r.id,
      transaction_id: r.transaction.id,
      ref_no: r.transaction.ref_no,
      date: r.transaction.date,
      details: r.transaction.details,
      due_date: null,
      debit,
      credit,
      running_balance: runningBalance,
      match_id: matchLine?.match_id ?? null,
      match_status: matchLine?.match?.status ?? null,
    });
    closingBalance = runningBalance;
  }

  // Apply status filter
  const filtered = statusFilter === 'open'
    ? entries.filter(e => e.match_id === null)
    : entries;

  return NextResponse.json({
    account: {
      id: account.id,
      name: account.name,
      ledger: account.ledger,
      account_type: account.account_type,
      opening_balance: openingBalance,
      closing_balance: closingBalance,
    },
    entries: filtered,
  });
}
