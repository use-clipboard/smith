import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';
import { buildModuleChecker, moduleNotActive } from '@/lib/modules';
import { computeBalances, type BalanceAccount } from '@/lib/bookkeeping/balances';
import { buildStatements, detectSize, detectFramework } from '@/lib/accounts-studio/statements';
import type { TrialBalanceRow } from '@/components/features/accounts-studio/types';

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

const ISO = /^\d{4}-\d{2}-\d{2}$/;

const Body = z.object({
  bookId: z.string().uuid(),
  entityType: z.string().default('limited_company'),
  from: z.string().regex(ISO),
  to: z.string().regex(ISO),
  priorFrom: z.string().regex(ISO).nullable().optional(),
  priorTo: z.string().regex(ISO).nullable().optional(),
});

/** TB rows for display — debit/credit split from each account's net balance. */
function trialBalanceRows(accounts: BalanceAccount[]): TrialBalanceRow[] {
  return accounts
    .filter(a => Math.abs(a.balance) >= 0.005)
    .map(a => ({
      name: a.name,
      ledger: a.ledger,
      accountType: a.account_type,
      debit: a.balance > 0 ? a.balance : 0,
      credit: a.balance < 0 ? -a.balance : 0,
    }));
}

// ── POST /api/accounts-studio/import ─────────────────────────────────────────
// Pull a real trial balance from a bookkeeping book for a period (+ optional
// prior year) and build structured statutory statements. No simulation.
export async function POST(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { isModuleActive } = buildModuleChecker(ctx.activeModules);
  if (!isModuleActive('accounts-studio')) return moduleNotActive('accounts-studio');

  let body: z.infer<typeof Body>;
  try { body = Body.parse(await req.json()); }
  catch (e) { return NextResponse.json({ error: 'Invalid payload', detail: String(e) }, { status: 400 }); }

  const supabase = createClient();
  const { data: book, error: bookErr } = await supabase
    .from('bookkeeping_books')
    .select('id, firm_id, name')
    .eq('id', body.bookId).eq('firm_id', ctx.firmId)
    .single();
  if (bookErr || !book) return NextResponse.json({ error: 'Book not found' }, { status: 404 });

  const wantPrior = !!(body.priorFrom && body.priorTo);

  try {
    // Same slicing the report tabs use: P&L/TB exclude YET (keep the period's
    // income/expense activity — the TB and P&L share the same slice); BS is
    // cumulative as-at `to` with YET included (so retained earnings populate).
    const [curPl, curBs] = await Promise.all([
      computeBalances(supabase, body.bookId, { from: body.from, to: body.to, excludeTypes: ['YET'] }),
      computeBalances(supabase, body.bookId, { to: body.to }),
    ]);
    const tb = curPl;

    let prior = null as null | { pl: BalanceAccount[]; bs: BalanceAccount[]; bsNetProfit: number };
    if (wantPrior) {
      const [pPl, pBs] = await Promise.all([
        computeBalances(supabase, body.bookId, { from: body.priorFrom!, to: body.priorTo!, excludeTypes: ['YET'] }),
        computeBalances(supabase, body.bookId, { to: body.priorTo! }),
      ]);
      prior = { pl: pPl.accounts, bs: pBs.accounts, bsNetProfit: pBs.net_profit };
    }

    const statements = buildStatements(
      { pl: curPl.accounts, bs: curBs.accounts, bsNetProfit: curBs.net_profit },
      prior,
    );

    const turnover = statements.profitLoss.turnoverTotal;
    const grossAssets = statements.balanceSheet.totalAssets;
    const size = detectSize(turnover, grossAssets);
    const framework = detectFramework(body.entityType, size);

    return NextResponse.json({
      book: { id: book.id, name: book.name },
      statements,
      trialBalance: trialBalanceRows(tb.accounts),
      detected: {
        size,
        framework,
        turnover,
        totalAssets: grossAssets,
        netProfit: statements.profitLoss.netProfit,
        accountCount: tb.accounts.length,
      },
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Import failed' }, { status: 500 });
  }
}
