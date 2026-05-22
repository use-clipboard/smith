import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { getBookkeepingContext } from '@/lib/bookkeeping/server';

// ── GET /api/bookkeeping/books/[id]/cashflow ─────────────────────────────────
// Monthly cash-flow summary across all Bank ledger accounts.
//
// Returns:
//   {
//     from, to,
//     months: [
//       { month: 'YYYY-MM', label: 'Mar 2026',
//         opening: number,     // bank balance at start of month
//         receipts: number,    // sum of debits (money in) that month
//         payments: number,    // sum of credits (money out) that month
//         net: receipts - payments,
//         closing: number      // bank balance at end of month
//       }
//     ]
//   }
//
// Server does the heavy lifting so the UI can render the table without
// double-aggregating in JS.

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getBookkeepingContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const url = new URL(req.url);
  const fromParam = url.searchParams.get('from');
  const toParam   = url.searchParams.get('to');

  if (fromParam && !/^\d{4}-\d{2}-\d{2}$/.test(fromParam))
    return NextResponse.json({ error: 'Invalid from' }, { status: 400 });
  if (toParam && !/^\d{4}-\d{2}-\d{2}$/.test(toParam))
    return NextResponse.json({ error: 'Invalid to' }, { status: 400 });

  const supabase = createClient();
  // Confirm the book belongs to this firm
  const { data: book, error: bookErr } = await supabase
    .from('bookkeeping_books')
    .select('id, firm_id, created_at')
    .eq('id', params.id)
    .eq('firm_id', ctx.firmId)
    .single();
  if (bookErr || !book) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // 1. Get all Bank ledger account ids for this book
  const { data: bankAccounts, error: accErr } = await supabase
    .from('bookkeeping_accounts')
    .select('id')
    .eq('book_id', params.id)
    .eq('ledger', 'Bank')
    .eq('archived', false);
  if (accErr) return NextResponse.json({ error: accErr.message }, { status: 500 });

  const bankIds = (bankAccounts ?? []).map(a => a.id as string);
  if (bankIds.length === 0) {
    return NextResponse.json({ from: fromParam ?? null, to: toParam ?? null, months: [] });
  }

  // 2. Pull every bank-related split with its transaction date, in chunks.
  //    We grab everything up to `to` (or now) so we can compute opening
  //    balances correctly.
  const upperBound = toParam ?? new Date().toISOString().slice(0, 10);
  type SplitRow = { debit: number; credit: number; transaction: { date: string } | null };
  const rows: SplitRow[] = [];
  const PAGE = 1000;
  let start = 0;
  while (true) {
    let q = supabase
      .from('bookkeeping_transaction_splits')
      .select('debit, credit, transaction:bookkeeping_transactions!inner(date, book_id)')
      .in('account_id', bankIds)
      .eq('transaction.book_id', params.id)
      .lte('transaction.date', upperBound)
      .range(start, start + PAGE - 1);

    const { data, error } = await q;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data || data.length === 0) break;
    rows.push(...(data as unknown as SplitRow[]));
    if (data.length < PAGE) break;
    start += PAGE;
  }

  // 3. Compute net movement per calendar month (and overall opening up to a date).
  //    Convention: debit on a Bank account = money in (receipt); credit = money out (payment).
  const monthMovements = new Map<string, { receipts: number; payments: number }>();
  for (const r of rows) {
    if (!r.transaction) continue;
    const month = r.transaction.date.slice(0, 7);  // YYYY-MM
    const entry = monthMovements.get(month) ?? { receipts: 0, payments: 0 };
    entry.receipts += Number(r.debit);
    entry.payments += Number(r.credit);
    monthMovements.set(month, entry);
  }

  // Determine the range of months to render
  const fromMonth = (fromParam ?? minDate(monthMovements.keys()) ?? upperBound).slice(0, 7);
  const toMonth   = upperBound.slice(0, 7);

  const monthsList = monthsBetween(fromMonth, toMonth);
  if (monthsList.length === 0) {
    return NextResponse.json({ from: fromParam ?? null, to: toParam ?? null, months: [] });
  }

  // 4. Opening balance at the start of the first month = net movement on all
  //    bank accounts strictly BEFORE that month.
  let openingBeforeFirst = 0;
  for (const [m, mv] of monthMovements.entries()) {
    if (m < fromMonth) openingBeforeFirst += (mv.receipts - mv.payments);
  }

  // 5. Walk months in order, accumulating closing balances.
  const months = monthsList.map(m => {
    const mv = monthMovements.get(m) ?? { receipts: 0, payments: 0 };
    const opening = +openingBeforeFirst.toFixed(2);
    const receipts = +mv.receipts.toFixed(2);
    const payments = +mv.payments.toFixed(2);
    const net = +(receipts - payments).toFixed(2);
    const closing = +(opening + net).toFixed(2);
    openingBeforeFirst = closing; // carry to next month
    return {
      month: m,
      label: monthLabel(m),
      opening,
      receipts,
      payments,
      net,
      closing,
    };
  });

  return NextResponse.json({
    from: fromParam ?? null,
    to: toParam ?? null,
    months,
  });
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function minDate(keys: IterableIterator<string>): string | null {
  let m: string | null = null;
  for (const k of keys) {
    if (m === null || k < m) m = k;
  }
  return m ? `${m}-01` : null;
}

function monthsBetween(fromMonth: string, toMonth: string): string[] {
  // Both 'YYYY-MM'. Returns inclusive list.
  if (fromMonth > toMonth) return [];
  const out: string[] = [];
  const [fy, fm] = fromMonth.split('-').map(n => parseInt(n, 10));
  const [ty, tm] = toMonth.split('-').map(n => parseInt(n, 10));
  let y = fy, m = fm;
  while (y < ty || (y === ty && m <= tm)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    m++;
    if (m > 12) { m = 1; y++; }
  }
  return out;
}

function monthLabel(yyyyMm: string): string {
  const [y, m] = yyyyMm.split('-').map(n => parseInt(n, 10));
  const d = new Date(y, m - 1, 1);
  return d.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });
}
