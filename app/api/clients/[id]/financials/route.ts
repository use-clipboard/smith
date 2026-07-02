import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { getBookkeepingContext } from '@/lib/bookkeeping/server';
import { computeBalances } from '@/lib/bookkeeping/balances';

/**
 * GET /api/clients/[id]/financials
 *
 * Headline P&L + Balance Sheet figures for the client's bookkeeping book,
 * powering the Financial Snapshot panel on the client Overview tab.
 *
 * Period selection:
 *   • Prefer the latest CLOSED financial year (status = 'closed').
 *   • If none is closed yet, fall back to the current/open year (the FY that
 *     contains today, else the latest FY) and flag it `provisional` — the P&L
 *     is still in progress and the year-end journal hasn't been posted.
 *
 * Figures come from lib/bookkeeping/balances.computeBalances so they match the
 * bookkeeping tool's own P&L / BS reports:
 *   • P&L  — over the FY range, excluding year-end (YET) closing journals.
 *   • BS   — cumulative as-at the FY end, INCLUDING YET. Capital & reserves adds
 *            the derived profit/(loss) not yet carried to reserves (VT-style
 *            dynamic carry) so a provisional year still balances.
 *
 * Bookkeeping-gated + firm-scoped (via getBookkeepingContext). Always 200 with
 * `hasBook: false` when the client has no book / no usable period, so the panel
 * can render a clean empty state rather than an error.
 */

const r2 = (n: number) => +n.toFixed(2);

function fmtEndLabel(iso: string): string {
  // "2025-03-31" → "31 Mar 2025"
  const d = new Date(iso + 'T00:00:00Z');
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

interface FyRow { id: string; start_date: string; end_date: string; status: string }

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const ctx = await getBookkeepingContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const supabase = createClient();

  // Most-recently-updated non-archived book for this client (firm-scoped via RLS).
  const { data: book, error: bookErr } = await supabase
    .from('bookkeeping_books')
    .select('id, name, firm_id')
    .eq('client_id', params.id)
    .eq('firm_id', ctx.firmId)
    .eq('archived', false)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (bookErr) return NextResponse.json({ error: bookErr.message }, { status: 500 });
  if (!book) return NextResponse.json({ hasBook: false });

  // Financial years for the book.
  const { data: yearsRaw } = await supabase
    .from('bookkeeping_financial_years')
    .select('id, start_date, end_date, status')
    .eq('book_id', book.id)
    .order('end_date', { ascending: true });
  const years = (yearsRaw ?? []) as FyRow[];

  // Pick the period: latest closed year, else the current/open year fallback.
  const todayIso = new Date().toISOString().slice(0, 10);
  let chosen: FyRow | undefined;
  let status: 'closed' | 'provisional' = 'closed';

  const closed = years.filter(y => y.status === 'closed');
  if (closed.length > 0) {
    chosen = closed[closed.length - 1]; // years are asc by end_date
    status = 'closed';
  } else {
    // Fallback: the FY containing today, else the latest FY that has started.
    chosen = years.find(y => y.start_date <= todayIso && todayIso <= y.end_date)
      ?? [...years].reverse().find(y => y.start_date <= todayIso);
    status = 'provisional';
  }

  if (!chosen) {
    // Book exists but has no usable financial year (no year-end set yet).
    return NextResponse.json({ hasBook: true, bookId: book.id, bookName: book.name, hasPeriod: false });
  }

  const fyStart = chosen.start_date;
  const fyEnd = chosen.end_date;

  // P&L over the year (exclude year-end journals) + BS as-at year end (include them).
  const [pnl, bs] = await Promise.all([
    computeBalances(supabase, book.id, { from: fyStart, to: fyEnd, excludeTypes: ['YET'] }),
    computeBalances(supabase, book.id, { to: fyEnd }),
  ]);

  // ── P&L headlines (robust: keyed off account_type, not ledger names) ──────
  let turnover = 0, costOfSales = 0, totalExpenses = 0;
  for (const a of pnl.accounts) {
    if (a.account_type === 'income') {
      turnover += a.credit_total - a.debit_total;
    } else if (a.account_type === 'expense') {
      const amt = a.debit_total - a.credit_total;
      totalExpenses += amt;
      const lc = (a.ledger ?? '').toLowerCase();
      if (lc.includes('cost of sales') || lc.includes('cogs')) costOfSales += amt;
    }
  }
  const netProfit = turnover - totalExpenses;

  // ── Balance Sheet headlines ───────────────────────────────────────────────
  let totalAssets = 0, totalLiabilities = 0, equity = 0;
  for (const a of bs.accounts) {
    if (a.account_type === 'asset') totalAssets += a.balance;                 // debit − credit
    else if (a.account_type === 'liability') totalLiabilities += -a.balance;  // flip: credits positive
    else if (a.account_type === 'equity') equity += -a.balance;
  }
  const netAssets = totalAssets - totalLiabilities;
  // Add the year's result not yet carried to reserves (0 once a YET is posted),
  // mirroring the BS report's dynamic carry so the figure agrees with net assets.
  const capitalReserves = equity + bs.net_profit;

  return NextResponse.json({
    hasBook: true,
    hasPeriod: true,
    bookId: book.id,
    bookName: book.name,
    status,
    period: {
      fromIso: fyStart,
      toIso: fyEnd,
      endLabel: fmtEndLabel(fyEnd),
      label: `Year to ${fmtEndLabel(fyEnd)}`,
    },
    pnl: {
      turnover: r2(turnover),
      costOfSales: r2(costOfSales),
      grossProfit: r2(turnover - costOfSales),
      totalExpenses: r2(totalExpenses),
      netProfit: r2(netProfit),
    },
    bs: {
      totalAssets: r2(totalAssets),
      totalLiabilities: r2(totalLiabilities),
      netAssets: r2(netAssets),
      capitalReserves: r2(capitalReserves),
    },
  });
}
