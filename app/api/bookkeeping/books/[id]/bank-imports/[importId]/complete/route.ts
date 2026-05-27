import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase-server';
import { getBookkeepingContext } from '@/lib/bookkeeping/server';

// ── POST /api/bookkeeping/books/[id]/bank-imports/[importId]/complete ──────
// Mark a rec as RECONCILED. Locks the cleared splits at the API layer.
//
// Server-side validation:
//   • closing_balance must be set (lifted or typed)
//   • opening_balance + sum(cleared signed amounts) === closing_balance
//     (within £0.005 tolerance for rounding)
//
// Body (all optional — typically empty, but supports last-minute updates):
//   { closing_balance?: number, notes?: string }

const Body = z.object({
  closing_balance: z.number().optional(),
  notes: z.string().max(1000).nullable().optional(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string; importId: string } },
) {
  const ctx = await getBookkeepingContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  let body: z.infer<typeof Body> = {};
  try {
    const raw = await req.text();
    if (raw) body = Body.parse(JSON.parse(raw));
  } catch (e) {
    return NextResponse.json({ error: 'Invalid payload', detail: String(e) }, { status: 400 });
  }

  const supabase = createClient();

  // ── Firm + book + rec gate ─────────────────────────────────────────────
  const { data: imp } = await supabase
    .from('bookkeeping_bank_imports')
    .select(`
      id, book_id, account_id, status,
      opening_balance, closing_balance,
      book:bookkeeping_books!inner(firm_id)
    `)
    .eq('id', params.importId)
    .eq('book_id', params.id)
    .single();
  if (!imp) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  // @ts-expect-error — !inner guarantees the join
  if (imp.book.firm_id !== ctx.firmId) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  if (imp.status === 'reconciled') {
    return NextResponse.json({ error: 'Reconciliation is already complete.' }, { status: 409 });
  }
  if (imp.status === 'abandoned') {
    return NextResponse.json({ error: 'Reconciliation was abandoned. Start a new one.' }, { status: 409 });
  }

  const closing = body.closing_balance ?? (imp.closing_balance != null ? Number(imp.closing_balance) : null);
  if (closing == null) {
    return NextResponse.json({
      error: 'Set the closing balance before completing the reconciliation.',
    }, { status: 400 });
  }
  const opening = Number(imp.opening_balance ?? 0);

  // ── Compute the gap from cleared splits ────────────────────────────────
  // Signed convention: debit to the bank account = money in (+), credit = out (-).
  // Sum of cleared movements + opening should equal closing.
  const { data: clearedSplits } = await supabase
    .from('bookkeeping_transaction_splits')
    .select('id, debit, credit')
    .eq('cleared_in_rec_id', params.importId);
  const clearedTotal = (clearedSplits ?? []).reduce(
    (s, r) => s + Number(r.debit) - Number(r.credit), 0,
  );
  const gap = Math.round((closing - (opening + clearedTotal)) * 100) / 100;
  if (Math.abs(gap) >= 0.005) {
    return NextResponse.json({
      error: `Cannot complete — there's a gap of ${gap.toFixed(2)} between the statement balance and the cleared ledger total.`,
      gap, opening, closing, cleared_total: clearedTotal,
    }, { status: 400 });
  }

  // ── Flip the rec to reconciled ─────────────────────────────────────────
  const nowIso = new Date().toISOString();
  const patch: Record<string, unknown> = {
    status: 'reconciled',
    closing_balance: closing,
    reconciled_at: nowIso,
    reconciled_by: ctx.userId,
    completed_at:  nowIso,
    completed_by:  ctx.userId,
  };
  if (body.notes !== undefined) patch.notes = body.notes;

  const { data: updated, error } = await supabase
    .from('bookkeeping_bank_imports')
    .update(patch)
    .eq('id', params.importId)
    .select('*')
    .single();
  if (error || !updated) {
    return NextResponse.json({ error: error?.message ?? 'Failed to complete' }, { status: 500 });
  }

  return NextResponse.json({
    import: updated,
    cleared_splits: clearedSplits?.length ?? 0,
  });
}
