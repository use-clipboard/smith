import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { getBookkeepingContext } from '@/lib/bookkeeping/server';

/**
 * GET /api/bookkeeping/books/[id]/reconciled-status?ledger=Bank&from=&to=
 *
 * For each account in the given ledger, reports how many of its entries in the
 * date window are "settled" vs the total. Settled means either cleared in a
 * COMPLETED bank reconciliation (Bank ledger) OR allocated/matched against
 * another entry (Customers / Suppliers). The account list uses this to show a
 * "fully settled for this period" tick — a quick at-a-glance signal.
 *
 *   response: { statuses: { [accountId]: { total: number, reconciled: number } } }
 *
 * An account is "fully settled for the period" when total > 0 and
 * reconciled === total (decided by the caller). `reconciled` is the settled
 * count regardless of mechanism (rec-clear or match).
 */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getBookkeepingContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const supabase = createClient();
  const { data: book } = await supabase
    .from('bookkeeping_books')
    .select('id, firm_id')
    .eq('id', params.id)
    .eq('firm_id', ctx.firmId)
    .single();
  if (!book) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const url = new URL(req.url);
  const ledger = url.searchParams.get('ledger');
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');
  if (!ledger) return NextResponse.json({ error: 'ledger is required' }, { status: 400 });

  // Accounts in the ledger.
  const { data: accts, error: acctErr } = await supabase
    .from('bookkeeping_accounts')
    .select('id')
    .eq('book_id', params.id)
    .eq('ledger', ledger);
  if (acctErr) return NextResponse.json({ error: acctErr.message }, { status: 500 });
  const ids = (accts ?? []).map(a => a.id as string);
  if (ids.length === 0) return NextResponse.json({ statuses: {} });

  // All splits on those accounts in the window, with their reconciliation state.
  type Row = {
    account_id: string;
    cleared_in_rec_id: string | null;
    rec: { status: string } | { status: string }[] | null;
    match_line: { match_id: string }[] | { match_id: string } | null;
  };
  const statuses: Record<string, { total: number; reconciled: number }> = {};
  const PAGE = 1000;
  for (let fromIdx = 0; ; fromIdx += PAGE) {
    let q = supabase
      .from('bookkeeping_transaction_splits')
      .select(`
        account_id, cleared_in_rec_id,
        transaction:bookkeeping_transactions!inner(date, book_id),
        rec:bookkeeping_bank_imports!bookkeeping_transaction_splits_cleared_in_rec_id_fkey(status),
        match_line:bookkeeping_match_lines(match_id)
      `)
      .in('account_id', ids)
      .eq('transaction.book_id', params.id);
    if (from) q = q.gte('transaction.date', from);
    if (to)   q = q.lte('transaction.date', to);
    const { data, error } = await q.range(fromIdx, fromIdx + PAGE - 1);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    const batch = (data ?? []) as unknown as Row[];
    for (const r of batch) {
      const s = (statuses[r.account_id] ??= { total: 0, reconciled: 0 });
      s.total += 1;
      const rec = Array.isArray(r.rec) ? r.rec[0] : r.rec;
      const clearedInReconciledRec = !!r.cleared_in_rec_id && rec?.status === 'reconciled';
      const ml = r.match_line;
      const matched = Array.isArray(ml) ? ml.length > 0 : !!ml;
      if (clearedInReconciledRec || matched) s.reconciled += 1;
    }
    if (batch.length < PAGE) break;
  }

  return NextResponse.json({ statuses });
}
