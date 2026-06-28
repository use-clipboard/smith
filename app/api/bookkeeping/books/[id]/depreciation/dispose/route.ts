import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase-server';
import { getBookkeepingContext } from '@/lib/bookkeeping/server';
import type { Asset, DepreciationCharge, DepreciationMethod, LedgerDepreciationSetting } from '@/types/bookkeeping';
import {
  DISPOSAL_PL_ACCOUNT,
  chargeExpenseAccountName,
  chargeExpenseRole,
  depreciationNoun,
  faAccountNames,
  isFixedAssetLedger,
  resolveFaAccount,
  resolveBookAccount,
} from '@/lib/bookkeeping/fixedAssets';
import { computePeriodCharge } from '@/lib/bookkeeping/depreciation';

// ── POST /api/bookkeeping/books/[id]/depreciation/dispose ────────────────────
// Dispose of one asset from the schedule. Two journals are posted:
//   1. (optional) A depreciation catch-up to the disposal date, so accumulated
//      depreciation is current at the point of sale.
//   2. The disposal: removes the asset's cost (Cr Cost-disposals) and its
//      accumulated depreciation (Dr Depn-disposals), books any proceeds, and
//      sends the balancing gain/loss to "P/L on disposal of fixed assets".
const Body = z.object({
  asset_id: z.string().uuid(),
  disposal_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  proceeds: z.number().min(0).default(0),
  /** Where the proceeds land (e.g. the bank account). Required if proceeds > 0. */
  proceeds_account_id: z.string().uuid().nullable().optional(),
});

function dayAfter(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
async function nextRef(supabase: ReturnType<typeof createClient>, bookId: string, type: string) {
  const { data, error } = await supabase.rpc('bookkeeping_next_ref', { p_book_id: bookId, p_type: type });
  if (error || typeof data !== 'number') throw new Error(error?.message ?? 'Could not allocate ref');
  return { seq: data, refNo: `${type} ${String(data).padStart(6, '0')}` };
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getBookkeepingContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  let body: z.infer<typeof Body>;
  try { body = Body.parse(await req.json()); }
  catch (e) { return NextResponse.json({ error: 'Invalid payload', detail: String(e) }, { status: 400 }); }

  if (body.proceeds > 0 && !body.proceeds_account_id) {
    return NextResponse.json({ error: 'A proceeds account is required when there are disposal proceeds.' }, { status: 400 });
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
  if (book.period_lock_date && body.disposal_date <= book.period_lock_date && !isAdmin) {
    return NextResponse.json(
      { error: `Disposal date ${body.disposal_date} is on or before the period lock (${book.period_lock_date})` },
      { status: 403 },
    );
  }

  const { data: asset, error: assetErr } = await supabase
    .from('bookkeeping_assets')
    .select('*')
    .eq('id', body.asset_id)
    .eq('book_id', params.id)
    .single<Asset>();
  if (assetErr || !asset) return NextResponse.json({ error: 'Asset not found' }, { status: 404 });
  if (asset.status === 'disposed') {
    return NextResponse.json({ error: 'Asset is already disposed.' }, { status: 400 });
  }
  if (!isFixedAssetLedger(asset.ledger)) {
    return NextResponse.json({ error: 'Not a fixed-asset ledger' }, { status: 400 });
  }
  if (body.disposal_date < asset.purchase_date) {
    return NextResponse.json({ error: 'Disposal date is before the purchase date.' }, { status: 400 });
  }

  // Settings + posted charges for this asset (drive the catch-up calculation).
  const [settingsRes, chargesRes] = await Promise.all([
    supabase
      .from('bookkeeping_ledger_depreciation_settings')
      .select('*')
      .eq('book_id', params.id)
      .eq('ledger', asset.ledger)
      .order('effective_from', { ascending: true }),
    supabase
      .from('bookkeeping_depreciation_charges')
      .select('*')
      .eq('asset_id', asset.id)
      .order('period_to', { ascending: true }),
  ]);
  const settings = (settingsRes.data ?? []) as LedgerDepreciationSetting[];
  const charges = (chargesRes.data ?? []) as DepreciationCharge[];

  const postedToDate = round2(charges.reduce((s, c) => s + c.amount, 0));
  const accumulatedBfwd = round2(asset.opening_accumulated_depn + postedToDate);

  // Catch-up depreciation from the day after the last charged period (or the
  // purchase date if nothing's posted) up to the disposal date.
  const lastChargedTo = charges.length ? charges[charges.length - 1].period_to : null;
  const catchUpFrom = lastChargedTo ? dayAfter(lastChargedTo) : asset.purchase_date;

  let catchUp = 0;
  let catchUpMethod: DepreciationMethod | null = null;
  let catchUpRate: number | null = null;
  if (catchUpFrom <= body.disposal_date) {
    const computed = computePeriodCharge(
      { cost: asset.cost, purchase_date: asset.purchase_date, disposal_date: body.disposal_date, status: 'active' },
      settings,
      accumulatedBfwd,
      catchUpFrom,
      body.disposal_date,
    );
    catchUp = computed.amount;
    catchUpMethod = computed.method;
    catchUpRate = computed.annualRate;
  }

  const accumulatedAtDisposal = round2(accumulatedBfwd + catchUp);
  const nbv = round2(asset.cost - accumulatedAtDisposal);
  const profit = round2(body.proceeds - nbv); // +gain / −loss

  // Resolve accounts — by system_role first, name as fallback (see fixedAssets).
  const names = faAccountNames(asset.ledger);
  const { data: accts, error: acctErr } = await supabase
    .from('bookkeeping_accounts')
    .select('id, name, ledger, account_type, system_role')
    .eq('book_id', params.id);
  if (acctErr) return NextResponse.json({ error: acctErr.message }, { status: 500 });
  const all = accts ?? [];

  const costDisposalsAcct = resolveFaAccount(all, asset.ledger, 'costDisposals');
  const depnDisposalsAcct = resolveFaAccount(all, asset.ledger, 'depnDisposals');
  const plAcct = resolveBookAccount(all, 'disposal_pl', DISPOSAL_PL_ACCOUNT);
  if (!costDisposalsAcct) return NextResponse.json({ error: `Missing "${names.costDisposals}" account in ${asset.ledger}.` }, { status: 400 });
  if (!depnDisposalsAcct) return NextResponse.json({ error: `Missing "${names.depnDisposals}" account in ${asset.ledger}.` }, { status: 400 });
  if (!plAcct) return NextResponse.json({ error: `Missing P&L "${DISPOSAL_PL_ACCOUNT}" account.` }, { status: 400 });

  // ── Journal 1: depreciation catch-up (only if there's a charge) ───────────
  if (catchUp > 0) {
    const expenseName = chargeExpenseAccountName(asset.ledger);
    const depnChargeAcct = resolveFaAccount(all, asset.ledger, 'depnCharge');
    const expenseAcct = resolveBookAccount(all, chargeExpenseRole(asset.ledger), expenseName, 'expense');
    if (!depnChargeAcct) return NextResponse.json({ error: `Missing "${names.depnCharge}" account in ${asset.ledger}.` }, { status: 400 });
    if (!expenseAcct) return NextResponse.json({ error: `Missing P&L "${expenseName}" account.` }, { status: 400 });

    const noun = depreciationNoun(asset.ledger);
    const details = `${noun} to disposal — ${asset.description}`;
    let ref;
    try { ref = await nextRef(supabase, params.id, 'JRN'); }
    catch (e) { return NextResponse.json({ error: String(e) }, { status: 500 }); }

    const { data: depnTxn, error: depnTxnErr } = await supabase
      .from('bookkeeping_transactions')
      .insert({
        book_id: params.id, type: 'JRN', ref_no: ref.refNo, ref_seq: ref.seq,
        date: body.disposal_date, details, total: catchUp, vat_total: 0,
        status: 'posted', created_by: ctx.userId, posted_at: new Date().toISOString(),
      })
      .select('id').single();
    if (depnTxnErr || !depnTxn) return NextResponse.json({ error: depnTxnErr?.message ?? 'Insert failed' }, { status: 500 });

    const { error: depnSplitsErr } = await supabase.from('bookkeeping_transaction_splits').insert([
      { transaction_id: depnTxn.id, line_no: 1, account_id: expenseAcct.id, debit: catchUp, credit: 0, entry_details: details, fund_id: asset.fund_id },
      { transaction_id: depnTxn.id, line_no: 2, account_id: depnChargeAcct.id, debit: 0, credit: catchUp, entry_details: details, fund_id: asset.fund_id },
    ]);
    if (depnSplitsErr) {
      await supabase.from('bookkeeping_transactions').delete().eq('id', depnTxn.id);
      return NextResponse.json({ error: depnSplitsErr.message }, { status: 500 });
    }

    const { error: chargeErr } = await supabase.from('bookkeeping_depreciation_charges').insert({
      book_id: params.id, asset_id: asset.id,
      period_from: catchUpFrom, period_to: body.disposal_date,
      amount: catchUp, method: catchUpMethod, annual_rate: catchUpRate,
      journal_txn_id: depnTxn.id, created_by: ctx.userId,
    });
    if (chargeErr) {
      await supabase.from('bookkeeping_transactions').delete().eq('id', depnTxn.id);
      return NextResponse.json({ error: chargeErr.message }, { status: 500 });
    }
  }

  // ── Journal 2: the disposal ───────────────────────────────────────────────
  const details = `Disposal — ${asset.description}`;
  let ref;
  try { ref = await nextRef(supabase, params.id, 'JRN'); }
  catch (e) { return NextResponse.json({ error: String(e) }, { status: 500 }); }

  // Build splits. Total (for the header) is the larger side of the entry.
  type SplitRow = { line_no: number; account_id: string; debit: number; credit: number; entry_details: string };
  const splits: SplitRow[] = [];
  let line = 1;
  // Remove cost: credit Cost-disposals.
  if (asset.cost > 0) splits.push({ line_no: line++, account_id: costDisposalsAcct.id, debit: 0, credit: asset.cost, entry_details: details });
  // Remove accumulated depn: debit Depn-disposals.
  if (accumulatedAtDisposal > 0) splits.push({ line_no: line++, account_id: depnDisposalsAcct.id, debit: accumulatedAtDisposal, credit: 0, entry_details: details });
  // Proceeds.
  if (body.proceeds > 0 && body.proceeds_account_id) {
    splits.push({ line_no: line++, account_id: body.proceeds_account_id, debit: body.proceeds, credit: 0, entry_details: details });
  }
  // Balancing gain/loss to the disposal P&L account.
  if (profit > 0) splits.push({ line_no: line++, account_id: plAcct.id, debit: 0, credit: profit, entry_details: `Gain on disposal — ${asset.description}` });
  else if (profit < 0) splits.push({ line_no: line++, account_id: plAcct.id, debit: -profit, credit: 0, entry_details: `Loss on disposal — ${asset.description}` });

  const totalDr = round2(splits.reduce((s, x) => s + x.debit, 0));
  const totalCr = round2(splits.reduce((s, x) => s + x.credit, 0));
  if (Math.abs(totalDr - totalCr) > 0.005) {
    return NextResponse.json({ error: `Disposal out of balance: Dr ${totalDr} vs Cr ${totalCr}` }, { status: 500 });
  }

  const { data: dispTxn, error: dispTxnErr } = await supabase
    .from('bookkeeping_transactions')
    .insert({
      book_id: params.id, type: 'JRN', ref_no: ref.refNo, ref_seq: ref.seq,
      date: body.disposal_date, details, total: totalDr, vat_total: 0,
      status: 'posted', created_by: ctx.userId, posted_at: new Date().toISOString(),
    })
    .select('id').single();
  if (dispTxnErr || !dispTxn) return NextResponse.json({ error: dispTxnErr?.message ?? 'Insert failed' }, { status: 500 });

  const { error: dispSplitsErr } = await supabase
    .from('bookkeeping_transaction_splits')
    .insert(splits.map(s => ({ ...s, transaction_id: dispTxn.id, fund_id: asset.fund_id })));
  if (dispSplitsErr) {
    await supabase.from('bookkeeping_transactions').delete().eq('id', dispTxn.id);
    return NextResponse.json({ error: dispSplitsErr.message }, { status: 500 });
  }

  // Mark the asset disposed.
  const { error: updErr } = await supabase
    .from('bookkeeping_assets')
    .update({
      status: 'disposed',
      disposal_date: body.disposal_date,
      disposal_proceeds: body.proceeds,
      disposal_journal_id: dispTxn.id,
      updated_at: new Date().toISOString(),
    })
    .eq('id', asset.id);
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });

  await supabase.from('bookkeeping_audit').insert({
    book_id: params.id,
    user_id: ctx.userId,
    entity_type: 'asset',
    entity_id: asset.id,
    action: 'dispose',
    diff: {
      ref_no: ref.refNo,
      disposal_date: body.disposal_date,
      proceeds: body.proceeds,
      cost: asset.cost,
      accumulated_depn: accumulatedAtDisposal,
      catch_up_charge: catchUp,
      nbv,
      profit_or_loss: profit,
    },
  });

  return NextResponse.json({
    posted: true,
    disposal_transaction_id: dispTxn.id,
    ref_no: ref.refNo,
    catch_up_charge: catchUp,
    accumulated_depn: accumulatedAtDisposal,
    nbv,
    profit_or_loss: profit,
  });
}

// ── DELETE /api/bookkeeping/books/[id]/depreciation/dispose?asset_id=… ────────
// Reverse a disposal. Undoes everything POST did, in reverse order:
//   1. Delete the disposal journal (disposal_journal_id).
//   2. Delete any catch-up depreciation charge booked at the disposal date,
//      and its journal.
//   3. Reset the asset back to active, clearing disposal_date / proceeds /
//      disposal_journal_id.
// This is the counterpart to the depreciation Un-post — it lets the user
// correct a wrong disposal date, proceeds or a mistaken disposal entirely.
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getBookkeepingContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const assetId = new URL(req.url).searchParams.get('asset_id');
  if (!assetId) return NextResponse.json({ error: 'asset_id is required' }, { status: 400 });

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

  const { data: asset, error: assetErr } = await supabase
    .from('bookkeeping_assets')
    .select('*')
    .eq('id', assetId)
    .eq('book_id', params.id)
    .single<Asset>();
  if (assetErr || !asset) return NextResponse.json({ error: 'Asset not found' }, { status: 404 });
  if (asset.status !== 'disposed') {
    return NextResponse.json({ error: 'Asset is not disposed.' }, { status: 400 });
  }

  if (book.period_lock_date && asset.disposal_date && asset.disposal_date <= book.period_lock_date && !isAdmin) {
    return NextResponse.json(
      { error: `Disposal date ${asset.disposal_date} is on or before the period lock (${book.period_lock_date})` },
      { status: 403 },
    );
  }

  // 1. Delete the disposal journal (splits cascade).
  if (asset.disposal_journal_id) {
    const { error: delDispErr } = await supabase
      .from('bookkeeping_transactions')
      .delete()
      .eq('id', asset.disposal_journal_id)
      .eq('book_id', params.id);
    if (delDispErr) return NextResponse.json({ error: delDispErr.message }, { status: 500 });
  }

  // 2. Delete the catch-up depreciation charge booked at the disposal date
  //    (and its journal). Only the charge created by the disposal lands on the
  //    disposal date — earlier periodic charges keep their own period ends.
  if (asset.disposal_date) {
    const { data: catchUpCharges } = await supabase
      .from('bookkeeping_depreciation_charges')
      .select('id, journal_txn_id')
      .eq('asset_id', asset.id)
      .eq('period_to', asset.disposal_date);
    const journalIds = Array.from(
      new Set((catchUpCharges ?? []).map(c => c.journal_txn_id).filter(Boolean) as string[]),
    );
    if ((catchUpCharges ?? []).length > 0) {
      const { error: delChargeErr } = await supabase
        .from('bookkeeping_depreciation_charges')
        .delete()
        .eq('asset_id', asset.id)
        .eq('period_to', asset.disposal_date);
      if (delChargeErr) return NextResponse.json({ error: delChargeErr.message }, { status: 500 });
    }
    if (journalIds.length > 0) {
      const { error: delJrnErr } = await supabase
        .from('bookkeeping_transactions')
        .delete()
        .in('id', journalIds)
        .eq('book_id', params.id);
      if (delJrnErr) return NextResponse.json({ error: delJrnErr.message }, { status: 500 });
    }
  }

  // 3. Reactivate the asset.
  const { error: updErr } = await supabase
    .from('bookkeeping_assets')
    .update({
      status: 'active',
      disposal_date: null,
      disposal_proceeds: null,
      disposal_journal_id: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', asset.id);
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });

  await supabase.from('bookkeeping_audit').insert({
    book_id: params.id,
    user_id: ctx.userId,
    entity_type: 'asset',
    entity_id: asset.id,
    action: 'dispose_reverse',
    diff: {
      reversed_disposal_date: asset.disposal_date,
      reversed_proceeds: asset.disposal_proceeds,
      reversed_journal_id: asset.disposal_journal_id,
    },
  });

  return NextResponse.json({ ok: true });
}
