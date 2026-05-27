import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { getBookkeepingContext } from '@/lib/bookkeeping/server';

// ── POST /api/bookkeeping/books/[id]/transactions/[txId]/flip-direction ────
// Flip a PAY ↔ REC transaction's direction. Used by the bank-rec gap
// helper to one-click fix "this was entered as PAY but should be a REC"
// (and vice versa) without making the user open the editor.
//
// What changes:
//   • type        PAY → REC  /  REC → PAY  (CHQ → REC also supported —
//                 CHQ is a money-out type; its opposite is REC)
//   • ref_no      reallocated under the new type's counter
//   • splits      debit ↔ credit swapped on every line (preserves balance,
//                 mirrors the direction flip on every account touched)
//
// What we DON'T change:
//   • The analysis account choice. If the user originally posted an
//     "Expenses : Office costs" account for a PAY they later flipped to
//     REC, the analysis side is now a credit to Office costs which may
//     be incorrect categorisation — but the BANK side is right, which is
//     what the rec cares about. Flag in the response so the UI can warn.
//   • primary_account_id (still the bank account).
//   • Any cleared_in_rec_id pinning — the split is the same row with
//     swapped numbers; its rec-clearing state survives the flip.
//
// Guards mirror change-type: book/period locks, admin lock, VAT lock when
// VAT is involved. Returns 409 if the transaction is cleared in a
// RECONCILED rec (same rule that blocks ordinary edits — the user must
// reopen the rec first).

const FLIPPABLE = new Set(['PAY', 'CHQ', 'REC'] as const);

function oppositeType(t: string): 'PAY' | 'REC' | null {
  // CHQ flips to REC (a CHQ is essentially a PAY with its own ref series).
  if (t === 'PAY' || t === 'CHQ') return 'REC';
  if (t === 'REC') return 'PAY';
  return null;
}

export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string; txId: string } },
) {
  const ctx = await getBookkeepingContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const supabase = createClient();

  // ── Book gate ──────────────────────────────────────────────────────────
  const { data: book } = await supabase
    .from('bookkeeping_books')
    .select('id, firm_id, vat_registered, vat_lock_date, period_lock_date, admin_locked')
    .eq('id', params.id)
    .eq('firm_id', ctx.firmId)
    .single();
  if (!book) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const isAdmin = ctx.userRole === 'admin';
  if (book.admin_locked && !isAdmin) {
    return NextResponse.json({ error: 'Book is admin-locked' }, { status: 403 });
  }

  // ── Transaction + flip-eligibility check ───────────────────────────────
  const { data: existing } = await supabase
    .from('bookkeeping_transactions')
    .select('id, type, ref_no, date, vat_total')
    .eq('id', params.txId)
    .eq('book_id', params.id)
    .single();
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (!FLIPPABLE.has(existing.type as 'PAY' | 'CHQ' | 'REC')) {
    return NextResponse.json({
      error: `Can't flip a ${existing.type} — only PAY, CHQ and REC support quick direction flip.`,
    }, { status: 400 });
  }
  const newType = oppositeType(existing.type);
  if (!newType) {
    return NextResponse.json({ error: 'Could not determine the opposite type.' }, { status: 400 });
  }

  // ── Period lock ────────────────────────────────────────────────────────
  if (book.period_lock_date && existing.date <= book.period_lock_date && !isAdmin) {
    return NextResponse.json(
      { error: `Period locked through ${book.period_lock_date}` },
      { status: 403 },
    );
  }

  // ── VAT lock — flipping direction inverts the VAT impact (input ↔ output)
  // even if the absolute VAT amount stays the same, so we treat it like
  // change-type and refuse on filed VAT periods.
  if (
    book.vat_registered &&
    book.vat_lock_date &&
    existing.date <= book.vat_lock_date &&
    Number(existing.vat_total ?? 0) > 0 &&
    !isAdmin
  ) {
    return NextResponse.json({
      error: 'vat_period_locked',
      message: `This transaction carries VAT and falls in a filed VAT period (locked through ${book.vat_lock_date}). Flipping direction would alter what was filed.`,
    }, { status: 403 });
  }

  // ── Bank-rec lock — reconciled-rec edit guard ──────────────────────────
  const { data: clearedInClosedRec } = await supabase
    .from('bookkeeping_transaction_splits')
    .select('id, cleared_in_rec_id, rec:bookkeeping_bank_imports!bookkeeping_transaction_splits_cleared_in_rec_id_fkey(id, status, display_label, file_name)')
    .eq('transaction_id', params.txId)
    .not('cleared_in_rec_id', 'is', null);
  const blockingRec = (clearedInClosedRec ?? []).find(
    // @ts-expect-error — embed type isn't perfectly inferred
    s => s.rec?.status === 'reconciled',
  );
  if (blockingRec) {
    return NextResponse.json({
      error: 'bank_reconciled',
      // @ts-expect-error — embed type isn't perfectly inferred
      message: `This transaction is cleared inside a completed reconciliation (${blockingRec.rec.display_label ?? blockingRec.rec.file_name ?? 'rec'}). Reopen the rec from the History tab before flipping.`,
      // @ts-expect-error — embed type isn't perfectly inferred
      rec_id: blockingRec.rec.id,
    }, { status: 409 });
  }

  // ── Allocate new ref under the new type's counter ──────────────────────
  const { data: nextSeq, error: seqErr } = await supabase
    .rpc('bookkeeping_next_ref', { p_book_id: params.id, p_type: newType });
  if (seqErr || typeof nextSeq !== 'number') {
    return NextResponse.json({ error: seqErr?.message ?? 'Could not allocate new ref' }, { status: 500 });
  }
  const newRefNo = `${newType} ${String(nextSeq).padStart(6, '0')}`;

  // ── Update the header ──────────────────────────────────────────────────
  const { error: hdrErr } = await supabase
    .from('bookkeeping_transactions')
    .update({
      type: newType,
      ref_no: newRefNo,
      ref_seq: nextSeq,
      updated_at: new Date().toISOString(),
    })
    .eq('id', params.txId);
  if (hdrErr) return NextResponse.json({ error: hdrErr.message }, { status: 500 });

  // ── Swap debit/credit on every split ───────────────────────────────────
  // We do this in two passes (read → write) rather than a single SQL
  // UPDATE because PostgREST doesn't expose column-swap expressions.
  const { data: splits, error: splitsErr } = await supabase
    .from('bookkeeping_transaction_splits')
    .select('id, debit, credit')
    .eq('transaction_id', params.txId);
  if (splitsErr || !splits) {
    return NextResponse.json({ error: splitsErr?.message ?? 'Could not load splits to flip' }, { status: 500 });
  }
  for (const s of splits) {
    const { error: upErr } = await supabase
      .from('bookkeeping_transaction_splits')
      .update({ debit: Number(s.credit), credit: Number(s.debit) })
      .eq('id', s.id);
    if (upErr) {
      // Try to roll back the header so the row isn't half-flipped.
      await supabase
        .from('bookkeeping_transactions')
        .update({ type: existing.type, ref_no: existing.ref_no })
        .eq('id', params.txId);
      return NextResponse.json({ error: `Split flip failed: ${upErr.message}` }, { status: 500 });
    }
  }

  // Audit
  await supabase.from('bookkeeping_audit').insert({
    book_id: params.id,
    user_id: ctx.userId,
    entity_type: 'transaction',
    entity_id: params.txId,
    action: 'update',
    diff: {
      flip_direction: {
        from_type: existing.type, to_type: newType,
        old_ref_no: existing.ref_no, new_ref_no: newRefNo,
      },
    },
  });

  return NextResponse.json({
    transaction_id: params.txId,
    old_ref_no: existing.ref_no,
    new_ref_no: newRefNo,
    new_type: newType,
    warning: 'The analysis-side account choice (e.g. Expenses vs Income) wasn’t changed. Open the entry in Edit if you also need to re-categorise it.',
  });
}
