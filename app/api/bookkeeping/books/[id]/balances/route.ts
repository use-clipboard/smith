import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { getBookkeepingContext } from '@/lib/bookkeeping/server';

// ── GET /api/bookkeeping/books/[id]/balances ─────────────────────────────────
// Aggregated account balances across the requested date range. The TB, P&L
// and BS views all read from this — they just slice differently.
//
// Query params:
//   ?from=YYYY-MM-DD        — inclusive lower bound on transaction date
//   ?to=YYYY-MM-DD          — inclusive upper bound on transaction date
//   ?include_zero=true      — opt in to accounts with zero net balance
//                             (default: exclude unless they have non-zero
//                              debit OR credit totals)
//
// Response:
//   {
//     from, to,
//     accounts: [
//       { id, name, ledger, account_type, debit_total, credit_total, balance }
//     ],
//     totals: { debit_total, credit_total },
//     net_profit: number,
//   }
//
// `balance` = debit_total - credit_total. For asset/expense accounts this is
// the natural balance (positive). For liability/equity/income accounts it
// reads negative — the TB UI flips the sign so the report shows positive
// numbers on the right side.
//
// `net_profit` = sum of (credit - debit) over income + cost-of-sales +
// expense + taxation ledger accounts. Positive = profit.

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getBookkeepingContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const url = new URL(req.url);
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');
  const includeZero = url.searchParams.get('include_zero') === 'true';

  if (from && !/^\d{4}-\d{2}-\d{2}$/.test(from)) {
    return NextResponse.json({ error: 'Invalid from date — use YYYY-MM-DD' }, { status: 400 });
  }
  if (to && !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    return NextResponse.json({ error: 'Invalid to date — use YYYY-MM-DD' }, { status: 400 });
  }

  const supabase = createClient();
  const { data: book, error: bookErr } = await supabase
    .from('bookkeeping_books')
    .select('id, firm_id')
    .eq('id', params.id)
    .eq('firm_id', ctx.firmId)
    .single();
  if (bookErr || !book) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // Pull every split for the book within the date range. PostgREST joins
  // to the transaction for the date filter; we paginate ourselves because
  // a single TB request can run into thousands of rows on a real book.
  const PAGE_SIZE = 1000;
  type SplitRow = {
    debit: number;
    credit: number;
    account_id: string;
    account: { id: string; name: string; ledger: string | null; account_type: string; archived: boolean } | null;
    transaction: { date: string } | null;
  };
  const rows: SplitRow[] = [];
  let pageStart = 0;
  while (true) {
    let q = supabase
      .from('bookkeeping_transaction_splits')
      .select(`
        debit, credit, account_id,
        account:bookkeeping_accounts!inner(id, name, ledger, account_type, archived, book_id),
        transaction:bookkeeping_transactions!inner(date, book_id)
      `)
      .eq('account.book_id', params.id)
      .eq('transaction.book_id', params.id)
      .range(pageStart, pageStart + PAGE_SIZE - 1);

    if (from) q = q.gte('transaction.date', from);
    if (to)   q = q.lte('transaction.date', to);

    const { data, error } = await q;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data || data.length === 0) break;
    rows.push(...(data as unknown as SplitRow[]));
    if (data.length < PAGE_SIZE) break;
    pageStart += PAGE_SIZE;
  }

  // Aggregate per account.
  type Agg = {
    id: string;
    name: string;
    ledger: string | null;
    account_type: string;
    debit_total: number;
    credit_total: number;
  };
  const byAccount = new Map<string, Agg>();
  for (const r of rows) {
    if (!r.account) continue;
    const a = byAccount.get(r.account.id) ?? {
      id: r.account.id,
      name: r.account.name,
      ledger: r.account.ledger,
      account_type: r.account.account_type,
      debit_total: 0,
      credit_total: 0,
    };
    a.debit_total  = +(a.debit_total  + Number(r.debit)).toFixed(2);
    a.credit_total = +(a.credit_total + Number(r.credit)).toFixed(2);
    byAccount.set(r.account.id, a);
  }

  // Also include accounts that have NO movement in the period when explicitly
  // asked — useful for TB views that want to show every chart account.
  if (includeZero) {
    const { data: allAccounts } = await supabase
      .from('bookkeeping_accounts')
      .select('id, name, ledger, account_type')
      .eq('book_id', params.id)
      .eq('archived', false);
    for (const a of allAccounts ?? []) {
      if (!byAccount.has(a.id)) {
        byAccount.set(a.id, {
          id: a.id, name: a.name, ledger: a.ledger, account_type: a.account_type,
          debit_total: 0, credit_total: 0,
        });
      }
    }
  }

  const accounts = [...byAccount.values()]
    .map(a => ({ ...a, balance: +(a.debit_total - a.credit_total).toFixed(2) }))
    .sort((a, b) => {
      const ledgerCmp = (a.ledger ?? '').localeCompare(b.ledger ?? '');
      if (ledgerCmp !== 0) return ledgerCmp;
      return a.name.localeCompare(b.name);
    });

  const totals = accounts.reduce(
    (acc, a) => ({
      debit_total:  +(acc.debit_total  + a.debit_total).toFixed(2),
      credit_total: +(acc.credit_total + a.credit_total).toFixed(2),
    }),
    { debit_total: 0, credit_total: 0 },
  );

  // Net profit = sum of (credit - debit) over P&L accounts (income/expense).
  // Positive = profit.
  const netProfit = +(
    accounts
      .filter(a => a.account_type === 'income' || a.account_type === 'expense')
      .reduce((s, a) => s + (a.credit_total - a.debit_total), 0)
  ).toFixed(2);

  return NextResponse.json({
    from: from ?? null,
    to: to ?? null,
    accounts,
    totals,
    net_profit: netProfit,
  });
}
