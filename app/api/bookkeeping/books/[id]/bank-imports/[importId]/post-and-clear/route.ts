import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase-server';
import { getBookkeepingContext } from '@/lib/bookkeeping/server';
import { buildSplits } from '@/lib/bookkeeping/buildSplits';
import { TRANSACTION_TYPE_CONFIG } from '@/lib/bookkeeping/transactionTypeConfig';

// ── POST /api/bookkeeping/books/[id]/bank-imports/[importId]/post-and-clear
// One-shot "I spotted this on the statement but it isn't posted yet" flow.
//
// Posts a single transaction (PAY/REC/CHQ/TRF) using the same logic as the
// regular input sheet, then immediately clears its bank-side split into
// this rec — no need for the user to leave the workspace.
//
// Body shape mirrors a row from the bulk-manual route minus the array
// nesting — accepts the same VAT treatments, ref allocator, period locks.

const ROW_TYPES = ['PAY', 'CHQ', 'REC', 'TRF'] as const;
const VAT_TREATMENTS = ['no_vat','standard_20','reduced_5','zero','exempt','outside_scope'] as const;

const Body = z.object({
  type: z.enum(ROW_TYPES),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  payee_text: z.string().max(200).nullable().optional(),
  details:    z.string().max(500).nullable().optional(),
  total:      z.number().min(0),
  vat_total:  z.number().min(0).default(0),
  vat_rate:   z.number().min(0).max(100).nullable().optional(),
  vat_treatment: z.enum(VAT_TREATMENTS).nullable().optional(),
  /** Analysis (other side) account. For PAY/CHQ/REC this is the expense /
   *  income / etc. account; for TRF the OTHER bank account. */
  analysis_account_id: z.string().uuid(),
  entry_details: z.string().max(500).nullable().optional(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string; importId: string } },
) {
  const ctx = await getBookkeepingContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  let body: z.infer<typeof Body>;
  try { body = Body.parse(await req.json()); }
  catch (e) { return NextResponse.json({ error: 'Invalid payload', detail: String(e) }, { status: 400 }); }

  const supabase = createClient();

  // ── Book + rec + bank account gate ──────────────────────────────────────
  const { data: imp } = await supabase
    .from('bookkeeping_bank_imports')
    .select(`
      id, book_id, account_id, status,
      book:bookkeeping_books!inner(id, firm_id, vat_registered, vat_lock_date, period_lock_date, admin_locked)
    `)
    .eq('id', params.importId)
    .eq('book_id', params.id)
    .single();
  if (!imp) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  // @ts-expect-error — !inner guarantees the join
  const book = imp.book;
  if (book.firm_id !== ctx.firmId) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (imp.status === 'reconciled' || imp.status === 'abandoned') {
    return NextResponse.json({ error: `Cannot post into a ${imp.status} reconciliation.` }, { status: 409 });
  }
  if (book.admin_locked && ctx.userRole !== 'admin') {
    return NextResponse.json({ error: 'Book is admin-locked' }, { status: 403 });
  }
  if (book.period_lock_date && ctx.userRole !== 'admin' && body.date <= book.period_lock_date) {
    return NextResponse.json(
      { error: `Period locked through ${book.period_lock_date}` },
      { status: 403 },
    );
  }

  const config = TRANSACTION_TYPE_CONFIG[body.type];
  if (!config) return NextResponse.json({ error: `Unknown type ${body.type}` }, { status: 400 });

  // VAT routing accounts
  const vat = book.vat_registered ? (body.vat_total ?? 0) : 0;
  const net = round2(body.total - vat);
  if (net < 0) return NextResponse.json({ error: 'Net amount went negative — check VAT.' }, { status: 400 });

  const { data: vatAccounts } = await supabase
    .from('bookkeeping_accounts')
    .select('id, name')
    .eq('book_id', params.id)
    .eq('ledger', 'Creditors');
  const vatInputAccountId  = vatAccounts?.find(a => /VAT.*Input/i.test(a.name))?.id  ?? null;
  const vatOutputAccountId = vatAccounts?.find(a => /VAT.*Output/i.test(a.name))?.id ?? null;

  const splits = buildSplits({
    config,
    primaryAccountId:  imp.account_id,
    analysisAccountId: body.analysis_account_id,
    total: body.total,
    vat,
    net,
    vatInputAccountId,
    vatOutputAccountId,
    entryDetails: body.entry_details ?? null,
  });

  const totalDr = splits.reduce((s, x) => s + x.debit, 0);
  const totalCr = splits.reduce((s, x) => s + x.credit, 0);
  if (Math.abs(totalDr - totalCr) > 0.005) {
    return NextResponse.json({ error: `Out of balance: ${totalDr} vs ${totalCr}` }, { status: 400 });
  }

  // ── Allocate ref ────────────────────────────────────────────────────────
  const { data: nextSeq, error: seqErr } = await supabase
    .rpc('bookkeeping_next_ref', { p_book_id: params.id, p_type: body.type });
  if (seqErr || typeof nextSeq !== 'number') {
    return NextResponse.json({ error: seqErr?.message ?? 'Could not allocate ref' }, { status: 500 });
  }
  const refNo = `${body.type} ${String(nextSeq).padStart(6, '0')}`;

  // VAT-period override for late entries
  let vatPeriodOverride: string | null = null;
  if (book.vat_registered && book.vat_lock_date && body.date <= book.vat_lock_date && vat > 0) {
    vatPeriodOverride = addOneDay(book.vat_lock_date as string);
  }

  // ── Insert header ───────────────────────────────────────────────────────
  const { data: txn, error: txnErr } = await supabase
    .from('bookkeeping_transactions')
    .insert({
      book_id: params.id,
      type: body.type,
      ref_no: refNo,
      ref_seq: nextSeq,
      date: body.date,
      payee_text: body.payee_text ?? null,
      details: body.details ?? body.payee_text ?? null,
      total: body.total,
      vat_total: vat,
      vat_rate: body.vat_rate ?? null,
      vat_treatment: body.vat_treatment ?? null,
      vat_period_override: vatPeriodOverride,
      primary_account_id: imp.account_id,
      status: 'posted',
      created_by: ctx.userId,
      posted_at: new Date().toISOString(),
    })
    .select('id')
    .single();
  if (txnErr || !txn) return NextResponse.json({ error: txnErr?.message ?? 'Header insert failed' }, { status: 500 });

  // ── Insert splits ───────────────────────────────────────────────────────
  const splitRows = splits.map((s, idx) => ({
    transaction_id: txn.id,
    line_no: idx + 1,
    account_id: s.account_id,
    debit:  s.debit,
    credit: s.credit,
    entry_details: s.entry_details ?? null,
    notes:         s.notes ?? null,
  }));
  const { data: insertedSplits, error: splitsErr } = await supabase
    .from('bookkeeping_transaction_splits')
    .insert(splitRows)
    .select('id, account_id, debit, credit');
  if (splitsErr || !insertedSplits) {
    await supabase.from('bookkeeping_transactions').delete().eq('id', txn.id);
    return NextResponse.json({ error: splitsErr?.message ?? 'Split insert failed' }, { status: 500 });
  }

  // ── Clear the bank-side split into THIS rec ────────────────────────────
  const bankSplit = insertedSplits.find(s => s.account_id === imp.account_id);
  if (!bankSplit) {
    return NextResponse.json({ error: 'Posted, but couldn’t find the bank split to clear.' }, { status: 500 });
  }
  await supabase
    .from('bookkeeping_transaction_splits')
    .update({
      cleared_in_rec_id: params.importId,
      cleared_at: new Date().toISOString(),
    })
    .eq('id', bankSplit.id);

  // Bump rec status pending → in_progress (we just added a cleared item)
  if (imp.status === 'pending') {
    await supabase
      .from('bookkeeping_bank_imports')
      .update({ status: 'in_progress' })
      .eq('id', params.importId);
  }

  // Audit
  await supabase.from('bookkeeping_audit').insert({
    book_id: params.id,
    user_id: ctx.userId,
    entity_type: 'transaction',
    entity_id: txn.id,
    action: 'create',
    diff: { via: 'rec_post_and_clear', import_id: params.importId },
  });

  return NextResponse.json({
    transaction_id: txn.id,
    ref_no: refNo,
    cleared_split_id: bankSplit.id,
  });
}

function round2(n: number): number { return Math.round(n * 100) / 100; }
function addOneDay(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
