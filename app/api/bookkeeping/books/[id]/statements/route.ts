import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { getBookkeepingContext } from '@/lib/bookkeeping/server';
import { computeBalances } from '@/lib/bookkeeping/balances';
import {
  buildTrialBalanceText, buildProfitLossText, buildBalanceSheetText,
  combineStatements, type StatementSet,
} from '@/lib/bookkeeping/statementText';

// ── GET /api/bookkeeping/books/[id]/statements ───────────────────────────────
// Generate clean TEXT financial statements (TB / P&L / BS) for a period, for
// handing to the Accounts Review / Performance tools. Mirrors the report tabs'
// exact slicing so the handed-over numbers match what the user sees:
//   • P&L / TB → period activity, exclude_types=YET
//   • BS       → cumulative as-at `to`, no exclusions, net profit folded into equity
//
// Query params:
//   ?from=YYYY-MM-DD&to=YYYY-MM-DD     — the period (required)
//   ?prior_from=…&prior_to=…           — optional prior-year period (for the
//                                        tools' prior-year comparison input)
//
// Returns per-period { tbText, pnlText, bsText, combined } plus the resolved
// business name and the linked client's details (for prefilling tool fields).

const ISO = /^\d{4}-\d{2}-\d{2}$/;

function ukDate(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

async function statementsFor(
  supabase: ReturnType<typeof createClient>,
  bookId: string,
  businessName: string,
  from: string,
  to: string,
): Promise<StatementSet & { periodLabel: string; asAtLabel: string }> {
  const periodLabel = `For the period ${ukDate(from)} to ${ukDate(to)}`;
  const asAtLabel = ukDate(to);

  // Run the three slices in parallel — same params the report tabs use.
  const [tb, pl, bs] = await Promise.all([
    computeBalances(supabase, bookId, { from, to, excludeTypes: ['YET'], includeZero: false }),
    computeBalances(supabase, bookId, { from, to, excludeTypes: ['YET'] }),
    computeBalances(supabase, bookId, { to }),
  ]);

  return {
    periodLabel,
    asAtLabel,
    tbText:  buildTrialBalanceText(tb.accounts, { businessName, periodLabel }),
    pnlText: buildProfitLossText(pl.accounts, { businessName, periodLabel }),
    bsText:  buildBalanceSheetText(bs.accounts, bs.net_profit, { businessName, asAtLabel }),
  };
}

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getBookkeepingContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const url = new URL(req.url);
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');
  const priorFrom = url.searchParams.get('prior_from');
  const priorTo = url.searchParams.get('prior_to');

  if (!from || !to || !ISO.test(from) || !ISO.test(to)) {
    return NextResponse.json({ error: 'from and to (YYYY-MM-DD) are required' }, { status: 400 });
  }
  const wantPrior = !!(priorFrom && priorTo && ISO.test(priorFrom) && ISO.test(priorTo));

  const supabase = createClient();
  const { data: book, error: bookErr } = await supabase
    .from('bookkeeping_books')
    .select('id, firm_id, name, client_id')
    .eq('id', params.id)
    .eq('firm_id', ctx.firmId)
    .single();
  if (bookErr || !book) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // Linked client (for prefilling business name / type / VAT on the tool).
  let client: { id: string; name: string; client_ref: string | null; business_type: string | null; vat_number: string | null } | null = null;
  if (book.client_id) {
    const { data: c } = await supabase
      .from('clients')
      .select('id, name, client_ref, business_type, vat_number')
      .eq('id', book.client_id)
      .eq('firm_id', ctx.firmId)
      .single();
    client = c ?? null;
  }

  const businessName = client?.name ?? book.name;

  try {
    const current = await statementsFor(supabase, params.id, businessName, from, to);
    const currentCombined = combineStatements(current, `${businessName} — ${current.periodLabel}`);

    let prior: (Awaited<ReturnType<typeof statementsFor>> & { combined: string }) | null = null;
    if (wantPrior) {
      const p = await statementsFor(supabase, params.id, businessName, priorFrom!, priorTo!);
      prior = { ...p, combined: combineStatements(p, `${businessName} — Prior year — ${p.periodLabel}`) };
    }

    return NextResponse.json({
      businessName,
      client,
      current: { ...current, combined: currentCombined },
      prior,
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Failed to build statements' }, { status: 500 });
  }
}
