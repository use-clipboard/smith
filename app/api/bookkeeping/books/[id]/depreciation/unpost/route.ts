import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase-server';
import { getBookkeepingContext } from '@/lib/bookkeeping/server';
import { isFixedAssetLedger } from '@/lib/bookkeeping/fixedAssets';

// ── POST /api/bookkeeping/books/[id]/depreciation/unpost ─────────────────────
// Reverse a previously-posted depreciation period for ONE FA ledger. Deletes
// the per-asset charge rows for the period AND the journal(s) they reference,
// returning the schedule to an unposted/editable state so the user can change
// assets (add / alter cost / re-allocate b/fwd) and re-post.
//
// This is the counterpart to /depreciation/post and uses the same admin-lock +
// period-lock guards. Deleting the system-generated JRN (rather than posting a
// reversing journal) keeps the ledger clean and mirrors the bank-rec "reopen"
// pattern — the per-asset charge history is the source of truth and is removed
// in lock-step with the journal.
const Body = z.object({
  ledger: z.string().min(1),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getBookkeepingContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  let body: z.infer<typeof Body>;
  try { body = Body.parse(await req.json()); }
  catch (e) { return NextResponse.json({ error: 'Invalid payload', detail: String(e) }, { status: 400 }); }

  if (!isFixedAssetLedger(body.ledger)) {
    return NextResponse.json({ error: 'Not a fixed-asset ledger' }, { status: 400 });
  }
  if (body.from > body.to) {
    return NextResponse.json({ error: 'from must be on or before to' }, { status: 400 });
  }

  const supabase = createClient();
  const { data: book, error: bookErr } = await supabase
    .from('bookkeeping_books')
    .select('id, firm_id, admin_locked, period_lock_date')
    .eq('id', params.id)
    .eq('firm_id', ctx.firmId)
    .single();
  if (bookErr || !book) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const isAdmin = ctx.userRole === 'admin';
  if (book.admin_locked && !isAdmin) {
    return NextResponse.json({ error: 'Book is admin-locked' }, { status: 403 });
  }
  // The charge is dated at period end — block reversal if that falls in a
  // locked period (same guard the post route uses).
  if (book.period_lock_date && body.to <= book.period_lock_date && !isAdmin) {
    return NextResponse.json(
      { error: `Period end ${body.to} is on or before the period lock (${book.period_lock_date})` },
      { status: 403 },
    );
  }

  // Which assets belong to this ledger? Charges are keyed by asset, so we
  // scope the reversal to this ledger's assets + the exact period.
  const { data: assets } = await supabase
    .from('bookkeeping_assets')
    .select('id')
    .eq('book_id', params.id)
    .eq('ledger', body.ledger);
  const assetIds = (assets ?? []).map(a => a.id);
  if (assetIds.length === 0) {
    return NextResponse.json({ reversed: false, message: 'No assets in this category.' });
  }

  const { data: charges } = await supabase
    .from('bookkeeping_depreciation_charges')
    .select('id, journal_txn_id')
    .eq('book_id', params.id)
    .eq('period_from', body.from)
    .eq('period_to', body.to)
    .in('asset_id', assetIds);

  if (!charges || charges.length === 0) {
    return NextResponse.json({ reversed: false, message: 'Nothing posted for this period.' });
  }

  const chargeIds = charges.map(c => c.id);
  const txnIds = [...new Set(charges.map(c => c.journal_txn_id).filter(Boolean) as string[])];

  // Remove the per-asset charge rows first (source of truth), then the
  // journal(s). Splits cascade with the transaction delete (same assumption
  // the post route's rollback relies on).
  const { error: delChargesErr } = await supabase
    .from('bookkeeping_depreciation_charges')
    .delete()
    .in('id', chargeIds);
  if (delChargesErr) {
    return NextResponse.json({ error: delChargesErr.message }, { status: 500 });
  }

  if (txnIds.length > 0) {
    const { error: delTxnErr } = await supabase
      .from('bookkeeping_transactions')
      .delete()
      .in('id', txnIds);
    if (delTxnErr) {
      return NextResponse.json({ error: delTxnErr.message }, { status: 500 });
    }
  }

  await supabase.from('bookkeeping_audit').insert({
    book_id: params.id,
    user_id: ctx.userId,
    entity_type: 'transaction',
    entity_id: txnIds[0] ?? null,
    action: 'delete',
    diff: {
      kind: 'depreciation_reversal',
      ledger: body.ledger,
      period: { from: body.from, to: body.to },
      reversed_charges: chargeIds.length,
      reversed_journals: txnIds,
    },
  });

  return NextResponse.json({
    reversed: true,
    charges_reversed: chargeIds.length,
    journals_reversed: txnIds.length,
  });
}
