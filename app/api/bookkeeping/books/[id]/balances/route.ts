import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { getBookkeepingContext } from '@/lib/bookkeeping/server';
import { computeBalances } from '@/lib/bookkeeping/balances';

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
//   ?exclude_types=YET,...  — comma-separated transaction types to leave out
//                             of the aggregation. The P&L passes YET so that
//                             year-end closing journals don't zero out the
//                             income/expense accounts for the period. The
//                             Balance Sheet does NOT pass it, because YET is
//                             exactly what populates Retained Earnings.
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
  const excludeTypes = (url.searchParams.get('exclude_types') ?? '')
    .split(',').map(s => s.trim().toUpperCase()).filter(Boolean);

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

  // Aggregation now lives in lib/bookkeeping/balances.ts so this route and the
  // /statements endpoint compute from one source of truth.
  try {
    const result = await computeBalances(supabase, params.id, { from, to, includeZero, excludeTypes });
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Failed to load balances' }, { status: 500 });
  }
}
