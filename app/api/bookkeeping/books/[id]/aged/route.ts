import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { getBookkeepingContext } from '@/lib/bookkeeping/server';

// ── GET /api/bookkeeping/books/[id]/aged ─────────────────────────────────────
// Aged debtors (ledger=Customers) / aged creditors (ledger=Suppliers) report.
//
// Query params:
//   ?ledger=Customers|Suppliers   — which control ledger to age
//   ?as_at=YYYY-MM-DD             — the report date (ages measured back from here)
//
// Method (open-item FIFO, no reliance on the matches table):
//   For each account in the ledger we take every dated split up to as_at.
//   "Charges" are the invoice side (debits for Customers — they owe us more;
//   credits for Suppliers — we owe them more); "payments" are the opposite
//   side (receipts / payments / credit notes). We allocate the total payments
//   against the oldest open charges first (FIFO), then bucket each charge's
//   unpaid remainder by age = as_at − charge date:
//       0–30 (current) · 31–60 · 61–90 · 90+
//   A net credit balance (payments exceed charges — e.g. an overpayment or an
//   on-account credit) shows as a negative in the current bucket.
//
// Response:
//   { ledger, asAt, rows: [{ accountId, accountName, current, b30, b60, b90, total }], totals }

function daysBetween(fromIso: string, toIso: string): number {
  const [fy, fm, fd] = fromIso.split('-').map(Number);
  const [ty, tm, td] = toIso.split('-').map(Number);
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000);
}
const r2 = (n: number) => +n.toFixed(2);

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getBookkeepingContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const url = new URL(req.url);
  const ledger = url.searchParams.get('ledger');
  const asAt = url.searchParams.get('as_at');
  if (ledger !== 'Customers' && ledger !== 'Suppliers') {
    return NextResponse.json({ error: 'ledger must be Customers or Suppliers' }, { status: 400 });
  }
  if (!asAt || !/^\d{4}-\d{2}-\d{2}$/.test(asAt)) {
    return NextResponse.json({ error: 'as_at required — use YYYY-MM-DD' }, { status: 400 });
  }

  const supabase = createClient();
  const { data: book, error: bookErr } = await supabase
    .from('bookkeeping_books')
    .select('id, firm_id')
    .eq('id', params.id)
    .eq('firm_id', ctx.firmId)
    .single();
  if (bookErr || !book) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // Pull every split on this ledger's accounts dated up to as_at, paginated.
  const PAGE_SIZE = 1000;
  type SplitRow = {
    debit: number;
    credit: number;
    account_id: string;
    account: { id: string; name: string; ledger: string | null } | null;
    transaction: { date: string } | null;
  };
  const splitRows: SplitRow[] = [];
  let pageStart = 0;
  while (true) {
    const { data, error } = await supabase
      .from('bookkeeping_transaction_splits')
      .select(`
        debit, credit, account_id,
        account:bookkeeping_accounts!inner(id, name, ledger, book_id),
        transaction:bookkeeping_transactions!inner(date, book_id)
      `)
      .eq('account.book_id', params.id)
      .eq('transaction.book_id', params.id)
      .eq('account.ledger', ledger)
      .lte('transaction.date', asAt)
      .range(pageStart, pageStart + PAGE_SIZE - 1);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data || data.length === 0) break;
    splitRows.push(...(data as unknown as SplitRow[]));
    if (data.length < PAGE_SIZE) break;
    pageStart += PAGE_SIZE;
  }

  // Group by account into charge/payment items.
  type Item = { date: string; charge: number; pay: number };
  const byAccount = new Map<string, { id: string; name: string; items: Item[] }>();
  for (const row of splitRows) {
    if (!row.account || !row.transaction) continue;
    const debit = Number(row.debit), credit = Number(row.credit);
    const charge = ledger === 'Customers' ? debit : credit;
    const pay    = ledger === 'Customers' ? credit : debit;
    const acc = byAccount.get(row.account.id) ?? { id: row.account.id, name: row.account.name, items: [] };
    acc.items.push({ date: row.transaction.date, charge, pay });
    byAccount.set(row.account.id, acc);
  }

  type AgedRow = { accountId: string; accountName: string; current: number; b30: number; b60: number; b90: number; total: number };
  const rows: AgedRow[] = [];
  for (const acc of byAccount.values()) {
    const charges = acc.items
      .filter(i => i.charge > 0)
      .map(i => ({ date: i.date, remaining: i.charge }))
      .sort((a, b) => a.date.localeCompare(b.date));
    let payPool = r2(acc.items.reduce((s, i) => s + i.pay, 0));

    // FIFO: oldest charges absorb payments first.
    for (const c of charges) {
      if (payPool <= 0) break;
      const applied = Math.min(c.remaining, payPool);
      c.remaining = r2(c.remaining - applied);
      payPool = r2(payPool - applied);
    }

    let current = 0, b30 = 0, b60 = 0, b90 = 0;
    for (const c of charges) {
      if (c.remaining <= 0) continue;
      const age = daysBetween(c.date, asAt);
      if (age <= 30) current += c.remaining;
      else if (age <= 60) b30 += c.remaining;
      else if (age <= 90) b60 += c.remaining;
      else b90 += c.remaining;
    }
    // Leftover payments after settling all charges = credit balance on account.
    if (payPool > 0.005) current -= payPool;

    current = r2(current); b30 = r2(b30); b60 = r2(b60); b90 = r2(b90);
    const total = r2(current + b30 + b60 + b90);
    if (current === 0 && b30 === 0 && b60 === 0 && b90 === 0) continue; // fully settled — omit
    rows.push({ accountId: acc.id, accountName: acc.name, current, b30, b60, b90, total });
  }

  rows.sort((a, b) => b.total - a.total || a.accountName.localeCompare(b.accountName));

  const totals = rows.reduce(
    (t, r) => ({
      current: r2(t.current + r.current),
      b30: r2(t.b30 + r.b30),
      b60: r2(t.b60 + r.b60),
      b90: r2(t.b90 + r.b90),
      total: r2(t.total + r.total),
    }),
    { current: 0, b30: 0, b60: 0, b90: 0, total: 0 },
  );

  return NextResponse.json({ ledger, asAt, rows, totals });
}
