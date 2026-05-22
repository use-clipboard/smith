import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { getBookkeepingContext } from '@/lib/bookkeeping/server';
import { computeVatReturn } from '@/lib/bookkeeping/vatReturn';

// ── GET /api/bookkeeping/books/[id]/vat-return ──────────────────────────────
// Live VAT-return computation for a period. The figures are recomputed every
// call (no caching) — for the snapshotted "what was actually filed" figures
// hit /vat-returns instead.
//
// Query params:
//   ?from=YYYY-MM-DD  — inclusive lower bound (required)
//   ?to=YYYY-MM-DD    — inclusive upper bound (required)
//
// Response: the 9 boxes plus their HMRC labels, a memorandum row for late-
// entry VAT carried in from earlier periods, the outputs/inputs breakdown,
// and `filed_return` — non-null if a filing already exists for this exact
// period, so the UI can show the "Filed" banner.

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getBookkeepingContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const url = new URL(req.url);
  const from = url.searchParams.get('from');
  const to   = url.searchParams.get('to');

  if (!from || !/^\d{4}-\d{2}-\d{2}$/.test(from)) {
    return NextResponse.json({ error: 'Invalid or missing from date — use YYYY-MM-DD' }, { status: 400 });
  }
  if (!to || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    return NextResponse.json({ error: 'Invalid or missing to date — use YYYY-MM-DD' }, { status: 400 });
  }
  if (to < from) {
    return NextResponse.json({ error: '"to" must be on or after "from"' }, { status: 400 });
  }

  const supabase = createClient();
  const { data: book, error: bookErr } = await supabase
    .from('bookkeeping_books')
    .select('id, firm_id, vat_registered, vat_scheme, vat_lock_date')
    .eq('id', params.id)
    .eq('firm_id', ctx.firmId)
    .single();
  if (bookErr || !book) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  let figures;
  try {
    figures = await computeVatReturn(supabase, params.id, from, to);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Compute failed' }, { status: 500 });
  }

  // Is this exact period already filed? (latest filing wins.)
  const { data: filings } = await supabase
    .from('bookkeeping_vat_returns')
    .select('id, ref_no, ref_seq, period_from, period_to, box1, box2, box3, box4, box5, box6, box7, box8, box9, late_entry_vat, filed_at, filed_by, submitted_at, submission_method, hmrc_reference, notes, filing_journal_id')
    .eq('book_id', params.id)
    .eq('period_from', from)
    .eq('period_to', to)
    .order('filed_at', { ascending: false })
    .limit(1);
  const filedReturn = filings && filings.length > 0 ? filings[0] : null;

  return NextResponse.json({
    from, to,
    vat_registered: book.vat_registered,
    vat_scheme: book.vat_scheme,
    vat_lock_date: book.vat_lock_date,
    boxes: {
      box1: { label: 'VAT due in this period on sales and other outputs', value: figures.box1 },
      box2: { label: 'VAT due in this period on acquisitions from EU member states', value: figures.box2 },
      box3: { label: 'Total VAT due (Box 1 + Box 2)', value: figures.box3 },
      box4: { label: 'VAT reclaimed in this period on purchases and other inputs', value: figures.box4 },
      box5: { label: 'Net VAT to pay to HMRC (Box 3 − Box 4)', value: figures.box5 },
      box6: { label: 'Total value of sales, excluding VAT', value: figures.box6 },
      box7: { label: 'Total value of purchases, excluding VAT', value: figures.box7 },
      box8: { label: 'Total value of EU supplies of goods', value: figures.box8 },
      box9: { label: 'Total value of EU acquisitions of goods', value: figures.box9 },
    },
    late_entry_vat: figures.late_entry_vat,
    breakdown: { outputs: figures.outputs, inputs: figures.inputs },
    filed_return: filedReturn,
  });
}
