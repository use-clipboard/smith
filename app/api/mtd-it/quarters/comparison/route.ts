import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';

// GET /api/mtd-it/quarters/comparison?client_id=...&tax_year=2026
//   Returns per-quarter totals (income, expense, net) for every quarter
//   of the tax year that has any entries. Used by the PDF generator to
//   render the "Quarterly comparison" table on the cover page.
//
//   We exclude:
//     - deleted entries
//     - entries with an active flag (flagged_reason set + flag_dismissed false)
//   so the figures match the per-quarter P&L the user sees in-app.

interface RowOut {
  quarter:  1 | 2 | 3 | 4;
  income:   number;
  expense:  number;
  net:      number;
  /** Whether the quarter has been approved by the client. Drives a small
   *  badge in the cover-page table. */
  status:   string;
}

export async function GET(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const url = new URL(req.url);
  const clientId = url.searchParams.get('client_id');
  const taxYear  = parseInt(url.searchParams.get('tax_year') ?? '', 10);
  if (!clientId || !taxYear) {
    return NextResponse.json({ error: 'client_id and tax_year required' }, { status: 400 });
  }

  const supabase = createClient();

  // Firm-scope check via the client row
  const { data: client } = await supabase
    .from('clients')
    .select('id, firm_id')
    .eq('id', clientId)
    .maybeSingle();
  if (!client || client.firm_id !== ctx.firmId) {
    return NextResponse.json({ error: 'Client not found' }, { status: 404 });
  }

  // Pull every quarter row for this client/year
  const { data: quarters, error: qErr } = await supabase
    .from('mtd_it_quarters')
    .select('id, quarter, status, fx_rates')
    .eq('client_id', clientId)
    .eq('tax_year', taxYear);
  if (qErr) {
    console.error('GET /api/mtd-it/quarters/comparison quarters', qErr);
    return NextResponse.json({ error: 'Failed to load quarters' }, { status: 500 });
  }
  if (!quarters || quarters.length === 0) {
    return NextResponse.json({ tax_year: taxYear, rows: [] });
  }

  const quarterIds = quarters.map(q => q.id as string);

  // Pull entries in one go
  const { data: entries, error: eErr } = await supabase
    .from('mtd_it_entries')
    .select('quarter_id, entry_type, gross_amount, currency, fx_rate, gbp_amount, flagged_reason, flag_dismissed')
    .in('quarter_id', quarterIds);
  if (eErr) {
    console.error('GET /api/mtd-it/quarters/comparison entries', eErr);
    return NextResponse.json({ error: 'Failed to load entries' }, { status: 500 });
  }

  // Per-quarter fx-rate fallback map (jsonb {EUR: 0.85, USD: 0.78, ...})
  const fxByQuarter = new Map<string, Record<string, number>>();
  for (const q of quarters) {
    fxByQuarter.set(q.id as string, (q.fx_rates as Record<string, number>) ?? {});
  }

  // GBP amount mirroring lib/mtdIt/pnl.ts → gbpAmount
  function gbp(e: { currency: string; gross_amount: number | null; gbp_amount: number | null; fx_rate: number | null }, fx: Record<string, number>): number {
    const gross = e.gross_amount ?? 0;
    if (e.currency === 'GBP') return gross;
    if (typeof e.gbp_amount === 'number') return e.gbp_amount;
    const rate = e.fx_rate ?? fx[e.currency];
    if (!rate || !Number.isFinite(rate)) return 0;
    return gross * rate;
  }

  // Aggregate
  const totals = new Map<string, { income: number; expense: number }>();
  for (const id of quarterIds) totals.set(id, { income: 0, expense: 0 });
  for (const e of entries ?? []) {
    if (e.flagged_reason && !e.flag_dismissed) continue;
    const t = totals.get(e.quarter_id as string);
    if (!t) continue;
    const fx = fxByQuarter.get(e.quarter_id as string) ?? {};
    const val = gbp(e as { currency: string; gross_amount: number | null; gbp_amount: number | null; fx_rate: number | null }, fx);
    if ((e.entry_type as string) === 'income') t.income += val;
    else                                       t.expense += val;
  }

  const rows: RowOut[] = quarters
    .map(q => {
      const t = totals.get(q.id as string)!;
      return {
        quarter: q.quarter as 1 | 2 | 3 | 4,
        income:  t.income,
        expense: t.expense,
        net:     t.income - t.expense,
        status:  (q.status as string) ?? 'draft',
      };
    })
    .sort((a, b) => a.quarter - b.quarter);

  return NextResponse.json({ tax_year: taxYear, rows });
}
