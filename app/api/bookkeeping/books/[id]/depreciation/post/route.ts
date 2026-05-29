import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase-server';
import { getBookkeepingContext } from '@/lib/bookkeeping/server';
import {
  chargeExpenseAccountName,
  depreciationNoun,
  faAccountNames,
  isFixedAssetLedger,
} from '@/lib/bookkeeping/fixedAssets';
import { loadLedgerSchedule } from '@/lib/bookkeeping/depreciationServer';

// ── POST /api/bookkeeping/books/[id]/depreciation/post ───────────────────────
// Post the depreciation journal for ONE FA ledger over a period. One JRN per
// ledger: Dr P&L Depreciation/Amortisation, Cr the ledger's "…- charge"
// (accumulated depn) account, for the total of every asset's period charge.
// Per-asset charge rows are written (idempotent on asset+period) and the full
// breakdown is stored in the audit. Re-posting a period only charges assets
// not already charged for that exact period.
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
  // The charge is dated at period end — block if that falls in a locked period.
  if (book.period_lock_date && body.to <= book.period_lock_date && !isAdmin) {
    return NextResponse.json(
      { error: `Period end ${body.to} is on or before the period lock (${book.period_lock_date})` },
      { status: 403 },
    );
  }

  const schedule = await loadLedgerSchedule(supabase, params.id, body.ledger, body.from, body.to);

  // Only assets with a positive charge that hasn't already been posted for this
  // exact period contribute.
  const postable = schedule.rows.filter(r => r.periodCharge > 0 && !r.posted);
  const total = round2(postable.reduce((s, r) => s + r.periodCharge, 0));

  if (postable.length === 0 || total <= 0) {
    return NextResponse.json({
      posted: false,
      message: 'Nothing to post — every asset is already charged for this period or has no charge.',
    });
  }

  // Resolve the two accounts the journal hits.
  const names = faAccountNames(body.ledger);
  const expenseName = chargeExpenseAccountName(body.ledger); // 'Depreciation' | 'Amortisation'

  const { data: accts, error: acctErr } = await supabase
    .from('bookkeeping_accounts')
    .select('id, name, ledger, account_type')
    .eq('book_id', params.id);
  if (acctErr) return NextResponse.json({ error: acctErr.message }, { status: 500 });

  const depnChargeAcct = (accts ?? []).find(a => a.ledger === body.ledger && a.name === names.depnCharge);
  const expenseAcct = (accts ?? []).find(a => a.name === expenseName && a.account_type === 'expense');

  if (!depnChargeAcct) {
    return NextResponse.json(
      { error: `Missing "${names.depnCharge}" account in ${body.ledger}.` },
      { status: 400 },
    );
  }
  if (!expenseAcct) {
    return NextResponse.json(
      { error: `Missing P&L "${expenseName}" account.` },
      { status: 400 },
    );
  }

  // Allocate the journal ref.
  const { data: seq, error: seqErr } = await supabase
    .rpc('bookkeeping_next_ref', { p_book_id: params.id, p_type: 'JRN' });
  if (seqErr || typeof seq !== 'number') {
    return NextResponse.json({ error: seqErr?.message ?? 'Could not allocate ref' }, { status: 500 });
  }
  const refNo = `JRN ${String(seq).padStart(6, '0')}`;
  const noun = depreciationNoun(body.ledger);
  const details = `${noun} — ${body.ledger} (${body.from} to ${body.to})`;

  // Header.
  const { data: txn, error: txnErr } = await supabase
    .from('bookkeeping_transactions')
    .insert({
      book_id: params.id,
      type: 'JRN',
      ref_no: refNo,
      ref_seq: seq,
      date: body.to,
      payee_text: null,
      details,
      total,
      vat_total: 0,
      status: 'posted',
      created_by: ctx.userId,
      posted_at: new Date().toISOString(),
    })
    .select('id')
    .single();
  if (txnErr || !txn) {
    return NextResponse.json({ error: txnErr?.message ?? 'Insert failed' }, { status: 500 });
  }

  // Splits: Dr P&L expense, Cr accumulated-depn (the ledger's "…- charge").
  const { error: splitsErr } = await supabase
    .from('bookkeeping_transaction_splits')
    .insert([
      {
        transaction_id: txn.id,
        line_no: 1,
        account_id: expenseAcct.id,
        debit: total,
        credit: 0,
        entry_details: details,
      },
      {
        transaction_id: txn.id,
        line_no: 2,
        account_id: depnChargeAcct.id,
        debit: 0,
        credit: total,
        entry_details: details,
      },
    ]);
  if (splitsErr) {
    await supabase.from('bookkeeping_transactions').delete().eq('id', txn.id);
    return NextResponse.json({ error: splitsErr.message }, { status: 500 });
  }

  // Per-asset charge rows (idempotent via unique(asset_id, period_from, period_to)).
  const chargeRows = postable.map(r => ({
    book_id: params.id,
    asset_id: r.asset.id,
    period_from: body.from,
    period_to: body.to,
    amount: r.periodCharge,
    // Pin the method/rate actually charged so the schedule display can't drift
    // if a back-dated settings change is added later.
    method: r.method,
    annual_rate: r.annualRate,
    journal_txn_id: txn.id,
    created_by: ctx.userId,
  }));
  const { error: chargesErr } = await supabase
    .from('bookkeeping_depreciation_charges')
    .insert(chargeRows);
  if (chargesErr) {
    // Roll back the journal — the charge history is the source of truth and
    // must not drift from the posted journal.
    await supabase.from('bookkeeping_transactions').delete().eq('id', txn.id);
    return NextResponse.json({ error: chargesErr.message }, { status: 500 });
  }

  // Audit with the full per-asset breakdown.
  await supabase.from('bookkeeping_audit').insert({
    book_id: params.id,
    user_id: ctx.userId,
    entity_type: 'transaction',
    entity_id: txn.id,
    action: 'create',
    diff: {
      kind: 'depreciation',
      ledger: body.ledger,
      period: { from: body.from, to: body.to },
      ref_no: refNo,
      total,
      breakdown: postable.map(r => ({
        asset_id: r.asset.id,
        description: r.asset.description,
        method: r.method,
        annual_rate: r.annualRate,
        depn_bfwd: r.depnBroughtForward,
        charge: r.periodCharge,
        depn_cfwd: r.depnCarriedForward,
        nbv: r.nbv,
      })),
    },
  });

  return NextResponse.json({
    posted: true,
    transaction_id: txn.id,
    ref_no: refNo,
    total,
    assets_charged: postable.length,
  });
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
