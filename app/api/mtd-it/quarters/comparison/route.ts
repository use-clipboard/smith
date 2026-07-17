import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';
import { round2, shareAdjustedGbp } from '@/lib/mtdIt/amounts';
import { isEntryFlagged, reflagStoredRows, type FlaggableEntry } from '@/lib/mtdIt/flags';
import type { ValuableEntry } from '@/lib/mtdIt/amounts';
import { getQuarterDates } from '@/lib/mtdIt/quarters';
import type { MtdItQuarterType } from '@/types';

/** The entry columns this route needs: enough to derive flags and to value the
 *  row at the client's share. */
type ComparisonRow = FlaggableEntry & ValuableEntry & {
  quarter_id: string;
  entry_type: string;
};

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
    .select('id, firm_id, mtd_it_quarter_type')
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
    .select('quarter_id, stream, entry_type, entry_date, supplier, gross_amount, currency, fx_rate, gbp_amount, share_pct, flagged_reason, flag_dismissed')
    .in('quarter_id', quarterIds);
  if (eErr) {
    console.error('GET /api/mtd-it/quarters/comparison entries', eErr);
    return NextResponse.json({ error: 'Failed to load entries' }, { status: 500 });
  }

  // Per-quarter fx-rate fallback map (jsonb {EUR: 0.85, USD: 0.78, ...}) and
  // date window — out-of-range is judged against each quarter's own window.
  const fxByQuarter = new Map<string, Record<string, number>>();
  const rangeByQuarter = new Map<string, { from: string; to: string }>();
  const quarterType = (client.mtd_it_quarter_type ?? 'calendar') as MtdItQuarterType;
  for (const q of quarters) {
    fxByQuarter.set(q.id as string, (q.fx_rates as Record<string, number>) ?? {});
    rangeByQuarter.set(q.id as string, getQuarterDates(taxYear, q.quarter as 1 | 2 | 3 | 4, quarterType));
  }

  // Aggregate
  const totals = new Map<string, { income: number; expense: number }>();
  for (const id of quarterIds) totals.set(id, { income: 0, expense: 0 });
  // Derive flags per quarter, as the review editor does — out-of-range and
  // duplicate flags aren't stored, and older stored ones are stale.
  const allRows = (entries ?? []) as unknown as ComparisonRow[];
  const reflagged: ComparisonRow[] = [];
  for (const [qid, range] of rangeByQuarter) {
    const forQuarter = allRows.filter(e => e.quarter_id === qid);
    if (forQuarter.length > 0) reflagged.push(...reflagStoredRows(forQuarter, range.from, range.to));
  }
  for (const e of reflagged) {
    if (isEntryFlagged(e)) continue;
    const t = totals.get(e.quarter_id);
    if (!t) continue;
    const fx = fxByQuarter.get(e.quarter_id) ?? {};
    // Client's share, FX-converted — same rule as the P&L and the filing.
    const val = round2(shareAdjustedGbp(e, fx));
    if (e.entry_type === 'income') t.income += val;
    else                           t.expense += val;
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
