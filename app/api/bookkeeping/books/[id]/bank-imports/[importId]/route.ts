import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase-server';
import { getBookkeepingContext } from '@/lib/bookkeeping/server';

// ── /api/bookkeeping/books/[id]/bank-imports/[importId] ─────────────────────
// GET    → one import header + every parsed line + status of each line's match
// PATCH  → rename / mark complete / abandon
// DELETE → hard-delete the import and all its lines (un-reconciling any
//          previously matched splits as a side-effect via FK SET NULL)

const SELECT_IMPORT = `
  id, book_id, account_id, file_name, display_label,
  period_start, period_end, opening_balance, closing_balance,
  status, uploaded_by, uploaded_at, reconciled_at, reconciled_by
`;

const SELECT_LINE = `
  id, import_id, line_no, date, description, amount, statement_balance,
  matched_split_id, reconciled_at, reconciled_by, notes
`;

// ── GET ─────────────────────────────────────────────────────────────────────
export async function GET(_req: NextRequest, { params }: { params: { id: string; importId: string } }) {
  const ctx = await getBookkeepingContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const supabase = createClient();

  // Header — also verifies firm via the FK chain (RLS) + explicit book_id.
  const { data: imp, error: impErr } = await supabase
    .from('bookkeeping_bank_imports')
    .select(SELECT_IMPORT)
    .eq('id', params.importId)
    .eq('book_id', params.id)
    .single();
  if (impErr || !imp) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // Belt-and-braces firm check (RLS should already do this but cheap to repeat).
  const { data: book } = await supabase
    .from('bookkeeping_books').select('id').eq('id', imp.book_id).eq('firm_id', ctx.firmId).single();
  if (!book) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // Lines in line_no order — the order the user saw them in their original
  // file. For matched lines we also pull the linked transaction's ref + date
  // so the rec UI can show "matched against PAY 000123" without a second
  // round-trip per row.
  // Paginated — bank statements with thousands of lines (full-year CSV on
  // a busy account) would otherwise truncate at 1000.
  const PAGE = 1000;
  const lines: unknown[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data: batch, error: linesErr } = await supabase
      .from('bookkeeping_bank_lines')
      .select(`
        ${SELECT_LINE},
        matched_split:bookkeeping_transaction_splits!bookkeeping_bank_lines_matched_split_id_fkey(
          id, debit, credit,
          transaction:bookkeeping_transactions(id, type, ref_no, date, details)
        )
      `)
      .eq('import_id', params.importId)
      .order('line_no', { ascending: true })
      .range(from, from + PAGE - 1);
    if (linesErr) return NextResponse.json({ error: linesErr.message }, { status: 500 });
    const rows = (batch ?? []) as unknown[];
    lines.push(...rows);
    if (rows.length < PAGE) break;
  }

  return NextResponse.json({ import: imp, lines });
}

// ── PATCH ───────────────────────────────────────────────────────────────────
const PatchBody = z.object({
  display_label: z.string().max(80).nullable().optional(),
  status: z.enum(['pending', 'in_progress', 'reconciled', 'abandoned']).optional(),
  opening_balance: z.number().nullable().optional(),
  closing_balance: z.number().nullable().optional(),
  notes:           z.string().max(1000).nullable().optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: { id: string; importId: string } }) {
  const ctx = await getBookkeepingContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  let body: z.infer<typeof PatchBody>;
  try { body = PatchBody.parse(await req.json()); }
  catch (e) { return NextResponse.json({ error: 'Invalid payload', detail: String(e) }, { status: 400 }); }

  const supabase = createClient();
  const patch: Record<string, unknown> = {};
  if (body.display_label    !== undefined) patch.display_label    = body.display_label;
  if (body.opening_balance  !== undefined) patch.opening_balance  = body.opening_balance;
  if (body.closing_balance  !== undefined) patch.closing_balance  = body.closing_balance;
  if (body.notes            !== undefined) patch.notes            = body.notes;
  if (body.status           !== undefined) {
    patch.status = body.status;
    if (body.status === 'reconciled') {
      patch.reconciled_at = new Date().toISOString();
      patch.reconciled_by = ctx.userId;
    }
    if (body.status === 'pending' || body.status === 'in_progress') {
      patch.reconciled_at = null;
      patch.reconciled_by = null;
    }
  }

  const { data, error } = await supabase
    .from('bookkeeping_bank_imports')
    .update(patch)
    .eq('id', params.importId)
    .eq('book_id', params.id)
    .eq('firm_id', ctx.firmId)
    .select(SELECT_IMPORT)
    .single();
  if (error || !data) return NextResponse.json({ error: error?.message ?? 'Not found' }, { status: 404 });

  return NextResponse.json({ import: data });
}

// ── DELETE ──────────────────────────────────────────────────────────────────
// Cascades through bookkeeping_bank_lines via the FK definition; any
// previously linked splits have their matched_split_id removed automatically
// because the FK is ON DELETE SET NULL on the split side… wait, actually the
// FK on bank_lines.matched_split_id points TO splits (not the other way), so
// deleting the line drops the link cleanly. The underlying ledger
// transaction is unaffected — the rec ↔ posting relationship is one-way.
export async function DELETE(_req: NextRequest, { params }: { params: { id: string; importId: string } }) {
  const ctx = await getBookkeepingContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const supabase = createClient();

  // Firm gate
  const { data: book } = await supabase
    .from('bookkeeping_books').select('id').eq('id', params.id).eq('firm_id', ctx.firmId).single();
  if (!book) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const { error } = await supabase
    .from('bookkeeping_bank_imports')
    .delete()
    .eq('id', params.importId)
    .eq('book_id', params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
