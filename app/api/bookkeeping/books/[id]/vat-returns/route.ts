import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase-server';
import { getBookkeepingContext } from '@/lib/bookkeeping/server';
import { computeVatReturn } from '@/lib/bookkeeping/vatReturn';
import { recordVatFiling, VAT_RETURN_SELECT, shapeVatReturn } from '@/lib/bookkeeping/recordVatFiling';

// ── POST /api/bookkeeping/books/[id]/vat-returns ────────────────────────────
// File a VAT return for the given period. The server RECOMPUTES the 9-box
// figures from scratch (never trusts client-supplied figures), captures the
// full transaction breakdown into the snapshot column for audit, AND posts a
// closing journal that zeros the VAT control accounts and moves the net to
// "Net VAT due" — matching VT's accounting treatment.
//
// Body: { from, to, filing_date?, hmrc_reference?, notes?, lock_period,
//         submitted_at?, submission_method? }
//
// ── GET /api/bookkeeping/books/[id]/vat-returns ─────────────────────────────
// List every filed return for a book (newest first).

const FileBody = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to:   z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  filing_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  hmrc_reference: z.string().max(80).nullable().optional(),
  notes: z.string().max(1000).nullable().optional(),
  lock_period: z.boolean().default(true),
  /** ISO date — when the return was actually submitted to HMRC. Optional;
   *  null means "not yet submitted" or "submitted same day as filed". */
  submitted_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  submission_method: z.enum(['manual', 'mtd_api']).nullable().optional(),
});

// ── POST: file ─────────────────────────────────────────────────────────────
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getBookkeepingContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  let body: z.infer<typeof FileBody>;
  try { body = FileBody.parse(await req.json()); }
  catch (e) { return NextResponse.json({ error: 'Invalid payload', detail: String(e) }, { status: 400 }); }
  if (body.to < body.from) {
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
  if (!book.vat_registered) {
    return NextResponse.json({ error: 'This book is not VAT-registered.' }, { status: 400 });
  }

  // Recompute from scratch (server-side source of truth).
  let figures;
  try {
    figures = await computeVatReturn(supabase, params.id, body.from, body.to);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Compute failed' }, { status: 500 });
  }

  const submittedAtIso = body.submitted_at ? `${body.submitted_at}T00:00:00.000Z` : null;
  try {
    const result = await recordVatFiling(
      supabase, { userId: ctx.userId }, params.id, body.from, body.to, figures, book.vat_scheme,
      {
        filingDate: body.filing_date,
        hmrcReference: body.hmrc_reference ?? null,
        submissionMethod: body.submission_method ?? null,
        submittedAtIso,
        lockPeriod: body.lock_period,
        notes: body.notes ?? null,
      },
    );
    return NextResponse.json({ vat_return: result.filed, journal_warning: result.journalWarning });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Filing failed' }, { status: 500 });
  }
}

// ── GET: list ──────────────────────────────────────────────────────────────
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getBookkeepingContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const supabase = createClient();
  const { data: book, error: bookErr } = await supabase
    .from('bookkeeping_books')
    .select('id, firm_id')
    .eq('id', params.id)
    .eq('firm_id', ctx.firmId)
    .single();
  if (bookErr || !book) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const { data, error } = await supabase
    .from('bookkeeping_vat_returns')
    .select(VAT_RETURN_SELECT)
    .eq('book_id', params.id)
    .order('period_to', { ascending: false })
    .order('filed_at', { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ vat_returns: (data ?? []).map(shapeVatReturn) });
}
