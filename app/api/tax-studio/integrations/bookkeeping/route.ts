import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';
import { canAccessTaxStudio } from '@/lib/tax-studio/access';
import { computeBalances } from '@/lib/bookkeeping/balances';

export const dynamic = 'force-dynamic';

// GET /api/tax-studio/integrations/bookkeeping?clientId=<uuid>&taxYear=2025/26
// Reads the client's bookkeeping ledger net profit for the tax-year window
// (6 Apr–5 Apr) via the shared computeBalances helper, excluding year-end
// closing journals so P&L accounts aren't zeroed.
export async function GET(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!canAccessTaxStudio(ctx.email)) return NextResponse.json({ error: 'Tax Studio is not available for your account.' }, { status: 403 });

  const url = new URL(req.url);
  const clientId = url.searchParams.get('clientId');
  const taxYearLabel = url.searchParams.get('taxYear') ?? '';
  if (!clientId) return NextResponse.json({ error: 'clientId is required' }, { status: 400 });
  const startYear = parseInt(taxYearLabel.slice(0, 4), 10);
  if (Number.isNaN(startYear)) return NextResponse.json({ error: 'Invalid taxYear' }, { status: 400 });

  const from = `${startYear}-04-06`;
  const to = `${startYear + 1}-04-05`;

  const supabase = createClient();

  // Resolve the client's active book (firm-scoped).
  const { data: book, error: bErr } = await supabase
    .from('bookkeeping_books')
    .select('id, name')
    .eq('firm_id', ctx.firmId).eq('client_id', clientId).eq('archived', false)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (bErr) return NextResponse.json({ error: bErr.message }, { status: 500 });
  if (!book) return NextResponse.json({ found: false, bookName: '', from: '', to: '', turnover: 0, totalExpenses: 0, netProfit: 0 }, { status: 404 });

  try {
    const result = await computeBalances(supabase, book.id as string, { from, to, excludeTypes: ['YET'] });
    let turnover = 0, totalExpenses = 0;
    for (const a of result.accounts) {
      if (a.account_type === 'income') turnover += a.credit_total - a.debit_total;
      else if (a.account_type === 'expense') totalExpenses += a.debit_total - a.credit_total;
    }
    const netProfit = Math.round(result.net_profit);
    const found = turnover !== 0 || totalExpenses !== 0;
    return NextResponse.json({
      found,
      bookName: (book.name as string) ?? 'Bookkeeping',
      from, to,
      turnover: Math.round(turnover),
      totalExpenses: Math.round(totalExpenses),
      netProfit,
      note: found ? 'Accounts profit from the ledger — apply tax adjustments (disallowables, capital allowances) before finalising.' : undefined,
    });
  } catch (err) {
    console.error('[/api/tax-studio/integrations/bookkeeping]', err);
    return NextResponse.json({ error: 'Could not read the bookkeeping ledger.' }, { status: 500 });
  }
}
