import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase-server';
import { getBookkeepingContext } from '@/lib/bookkeeping/server';

// ── /api/bookkeeping/books/[id]/bank-imports/[importId]/lines/[lineId] ──────
// PATCH → match a line to a ledger split, un-match, or update a free-text note
//
// Body shape:
//   { matched_split_id: "<uuid>" }   → reconcile against this split
//   { matched_split_id: null }       → un-reconcile
//   { notes: "free text" }            → just edit the note
//
// Validation rules:
//   • The split must belong to a transaction on the SAME account as the
//     statement line. Otherwise reconciling against e.g. "Expenses" makes
//     no sense.
//   • The split's debit/credit sign and amount must match the line's
//     signed amount (positive line = debit to bank; matches a split that
//     debits the bank account). We compare absolute values so the user
//     gets a clear error if they pick the wrong row.
//   • A split can only ever be matched to one line — enforced by the
//     UNIQUE partial index in the migration.

const PatchBody = z.object({
  matched_split_id: z.string().uuid().nullable().optional(),
  notes: z.string().max(500).nullable().optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string; importId: string; lineId: string } },
) {
  const ctx = await getBookkeepingContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  let body: z.infer<typeof PatchBody>;
  try { body = PatchBody.parse(await req.json()); }
  catch (e) { return NextResponse.json({ error: 'Invalid payload', detail: String(e) }, { status: 400 }); }

  const supabase = createClient();

  // Load the line + its parent import + firm gate in one go.
  const { data: line, error: lineErr } = await supabase
    .from('bookkeeping_bank_lines')
    .select(`
      id, import_id, account_id, amount, matched_split_id,
      import:bookkeeping_bank_imports!inner(id, book_id),
      book:bookkeeping_books!inner(id, firm_id)
    `)
    .eq('id', params.lineId)
    .eq('import_id', params.importId)
    .single();
  if (lineErr || !line) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  // @ts-expect-error — !inner guarantees the join
  if (line.book.firm_id !== ctx.firmId) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  // @ts-expect-error — !inner guarantees the join
  if (line.import.book_id !== params.id) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };

  // ── Match / un-match path ──────────────────────────────────────────────
  if (body.matched_split_id !== undefined) {
    if (body.matched_split_id === null) {
      patch.matched_split_id = null;
      patch.reconciled_at = null;
      patch.reconciled_by = null;
    } else {
      // Validate the split is on the same account and the amounts agree.
      const { data: split } = await supabase
        .from('bookkeeping_transaction_splits')
        .select('id, account_id, debit, credit')
        .eq('id', body.matched_split_id)
        .single();
      if (!split) return NextResponse.json({ error: 'Split not found' }, { status: 404 });
      if (split.account_id !== line.account_id) {
        return NextResponse.json({
          error: 'You can only reconcile against entries posted to this same bank account.',
        }, { status: 400 });
      }
      const splitSigned = Number(split.debit) - Number(split.credit);
      const lineSigned  = Number(line.amount);
      if (Math.abs(splitSigned - lineSigned) > 0.005) {
        return NextResponse.json({
          error: `Amount doesn't match — statement line is ${lineSigned.toFixed(2)} but the ledger entry is ${splitSigned.toFixed(2)}.`,
        }, { status: 400 });
      }
      // The unique partial index will reject this if the split is already
      // matched to another line, but we get a friendlier message by
      // checking first.
      const { data: clashing } = await supabase
        .from('bookkeeping_bank_lines')
        .select('id, import_id')
        .eq('matched_split_id', body.matched_split_id)
        .neq('id', params.lineId)
        .maybeSingle();
      if (clashing) {
        return NextResponse.json({
          error: 'That ledger entry is already reconciled against a different statement line.',
        }, { status: 409 });
      }

      patch.matched_split_id = body.matched_split_id;
      patch.reconciled_at = new Date().toISOString();
      patch.reconciled_by = ctx.userId;
    }
  }

  if (body.notes !== undefined) patch.notes = body.notes;

  const { data, error } = await supabase
    .from('bookkeeping_bank_lines')
    .update(patch)
    .eq('id', params.lineId)
    .eq('import_id', params.importId)
    .select(`
      id, import_id, line_no, date, description, amount, statement_balance,
      matched_split_id, reconciled_at, reconciled_by, notes,
      matched_split:bookkeeping_transaction_splits!bookkeeping_bank_lines_matched_split_id_fkey(
        id, debit, credit,
        transaction:bookkeeping_transactions(id, type, ref_no, date, details)
      )
    `)
    .single();
  if (error || !data) return NextResponse.json({ error: error?.message ?? 'Update failed' }, { status: 500 });

  // Bump the parent import's status — pending → in_progress on first match,
  // back to pending if every line is now un-matched.
  await refreshImportStatus(supabase, params.importId);

  return NextResponse.json({ line: data });
}

async function refreshImportStatus(supabase: ReturnType<typeof createClient>, importId: string) {
  const { data: rows } = await supabase
    .from('bookkeeping_bank_lines')
    .select('id, matched_split_id')
    .eq('import_id', importId);
  if (!rows) return;
  const matched = rows.filter(r => r.matched_split_id != null).length;
  let nextStatus: 'pending' | 'in_progress' | 'reconciled';
  if (matched === 0) nextStatus = 'pending';
  else if (matched === rows.length) nextStatus = 'reconciled';
  else nextStatus = 'in_progress';

  // Only patch when changing — saves a write on every match toggle once
  // we're already in_progress.
  const { data: current } = await supabase
    .from('bookkeeping_bank_imports')
    .select('status')
    .eq('id', importId)
    .single();
  if (current?.status === nextStatus) return;
  await supabase
    .from('bookkeeping_bank_imports')
    .update({
      status: nextStatus,
      reconciled_at: nextStatus === 'reconciled' ? new Date().toISOString() : null,
    })
    .eq('id', importId);
}
