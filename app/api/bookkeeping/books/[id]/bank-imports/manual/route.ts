import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase-server';
import { getBookkeepingContext } from '@/lib/bookkeeping/server';
import { buildSplits } from '@/lib/bookkeeping/buildSplits';
import { TRANSACTION_TYPE_CONFIG } from '@/lib/bookkeeping/transactionTypeConfig';
import { detectDuplicateLines } from '@/lib/bookkeeping/dupeDetect';

// ── /api/bookkeeping/books/[id]/bank-imports/manual ─────────────────────────
// Manual reconciliation entry point. Takes a list of rows (PAY/CHQ/REC/TRF
// mixed) typed by the user in the multi-type sheet, posts each row as a real
// transaction, AND creates a reconciled bank_lines row pointing at the bank
// side of each transaction.
//
// Why one endpoint rather than the client looping over POST /transactions:
//   • Atomicity (best-effort) — partial failures roll back the parent import
//     so the books never carry half a rec session.
//   • One round-trip — sheets can be 20-30 rows long; serial round-trips would
//     feel slow on shaky connections.
//   • Lets us derive period_start/period_end from the rows and set the rec
//     to `reconciled` straight away.

const ROW_TYPES = ['PAY', 'CHQ', 'REC', 'TRF'] as const;
const VAT_TREATMENTS = ['no_vat','standard_20','reduced_5','zero','exempt','outside_scope'] as const;

const RowSchema = z.object({
  type: z.enum(ROW_TYPES),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  payee_text: z.string().max(200).nullable().optional(),
  details: z.string().max(500).nullable().optional(),
  // Allow 0 — zero-amount rows are legitimate "reminder" entries (place-
  // holder transactions the user wants on the ledger without value yet).
  total: z.number().min(0),
  vat_total: z.number().min(0).default(0),
  vat_rate: z.number().min(0).max(100).nullable().optional(),
  vat_treatment: z.enum(VAT_TREATMENTS).nullable().optional(),
  /** Analysis account. For PAY/CHQ/REC this is the expense/income/etc.
   *  account; for TRF this is the OTHER bank account being transferred to/from. */
  analysis_account_id: z.string().uuid(),
  entry_details: z.string().max(500).nullable().optional(),
});

const PostBody = z.object({
  account_id: z.string().uuid(),
  display_label: z.string().max(80).optional(),
  rows: z.array(RowSchema).min(1).max(200),
  /** When set, the posted rows are attached to the named active rec rather
   *  than creating a fresh import row. Used by the workspace's Manual
   *  entry sheet — keeps everything posted on the active rec instead of
   *  spawning a sibling import that would breach the one-active-rec
   *  partial unique index. */
  existing_import_id: z.string().uuid().optional(),
  /** User has reviewed the suspected duplicates and wants to post them
   *  anyway. When false (default) and dupes are found we 409 with the
   *  list so the UI can show a review screen. */
  confirm_duplicates: z.boolean().optional(),
  /** Row indices the user chose to skip after seeing the dupe warning. */
  skip_row_indices: z.array(z.number().int().min(0)).optional(),
});

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getBookkeepingContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  let body: z.infer<typeof PostBody>;
  try { body = PostBody.parse(await req.json()); }
  catch (e) { return NextResponse.json({ error: 'Invalid payload', detail: String(e) }, { status: 400 }); }

  const supabase = createClient();

  // ── Verify book + bank account in this firm ────────────────────────────
  const { data: book, error: bookErr } = await supabase
    .from('bookkeeping_books')
    .select('id, firm_id, vat_registered, vat_lock_date, period_lock_date, admin_locked')
    .eq('id', params.id)
    .eq('firm_id', ctx.firmId)
    .single();
  if (bookErr || !book) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (book.admin_locked && ctx.userRole !== 'admin') {
    return NextResponse.json({ error: 'Book is admin-locked' }, { status: 403 });
  }

  const { data: bankAccount } = await supabase
    .from('bookkeeping_accounts')
    .select('id, name, ledger, account_type, book_id')
    .eq('id', body.account_id)
    .eq('book_id', params.id)
    .single();
  if (!bankAccount) return NextResponse.json({ error: 'Bank account not found' }, { status: 404 });

  // Pull the VAT routing accounts once (only matters if any row has VAT > 0).
  const { data: vatAccounts } = await supabase
    .from('bookkeeping_accounts')
    .select('id, name, ledger')
    .eq('book_id', params.id)
    .eq('ledger', 'Creditors');
  const vatInputAccountId  = vatAccounts?.find(a => /VAT.*Input/i.test(a.name))?.id  ?? null;
  const vatOutputAccountId = vatAccounts?.find(a => /VAT.*Output/i.test(a.name))?.id ?? null;

  // ── Skip & duplicate handling ──────────────────────────────────────────
  // We honour the caller's per-row skip list first, then scan whatever
  // remains for suspected dupes against existing splits on this account.
  // Returning 409 with the suspect list lets the UI show a review screen
  // before any rows hit the ledger.
  const skipRowSet = new Set(body.skip_row_indices ?? []);
  const rowsAfterSkip = body.rows
    .map((r, originalIndex) => ({ originalIndex, row: r }))
    .filter(x => !skipRowSet.has(x.originalIndex));
  if (rowsAfterSkip.length === 0) {
    return NextResponse.json({ error: 'Every row was skipped — nothing to post.' }, { status: 400 });
  }

  if (!body.confirm_duplicates) {
    // Compute the signed bank-side amount per row so the helper can match
    // it against existing splits. For PAY/CHQ the bank side is a credit
    // (money out, signed negative); for REC it's a debit (money in,
    // positive). TRF "from" side is a credit. buildSplits is the source of
    // truth — we encode the same convention here.
    const candidates = rowsAfterSkip.map(x => {
      const sign = (x.row.type === 'REC') ? 1 : -1;
      return { date: x.row.date, amount: sign * x.row.total };
    });
    const dupes = await detectDuplicateLines(
      supabase,
      params.id,
      body.account_id,
      candidates,
    );
    const flagged = dupes.filter(d => d.match != null);
    if (flagged.length > 0) {
      return NextResponse.json({
        error: 'suspected_duplicates',
        suspected_duplicates: flagged.map(d => ({
          row_index: rowsAfterSkip[d.index].originalIndex,
          row:       rowsAfterSkip[d.index].row,
          match:     d.match,
        })),
      }, { status: 409 });
    }
  }

  // ── Period start/end derived from the (post-skip) rows ─────────────────
  const postSkipRows = rowsAfterSkip.map(x => x.row);
  const dates = postSkipRows.map(r => r.date).sort();
  const periodStart = dates[0];
  const periodEnd   = dates[dates.length - 1];

  // Block any row that falls inside a locked period (admin escape hatch).
  if (book.period_lock_date && ctx.userRole !== 'admin') {
    const lock = book.period_lock_date as string;
    const earliest = dates[0];
    if (earliest <= lock) {
      return NextResponse.json(
        { error: `Period locked through ${lock} — one or more rows fall inside the locked period.` },
        { status: 403 },
      );
    }
  }

  // ── Resolve parent import — existing rec OR new ────────────────────────
  // When the sheet is opened from inside the period-first workspace, we
  // attach the posted rows to the active rec rather than creating a
  // sibling one (which would violate the one-active-rec partial unique
  // index). When called without existing_import_id the legacy "manual rec
  // = fresh import" behaviour stands.
  let imp: { id: string } | null = null;
  if (body.existing_import_id) {
    const { data: target, error: targetErr } = await supabase
      .from('bookkeeping_bank_imports')
      .select('id, account_id, status, period_start, period_end')
      .eq('id', body.existing_import_id)
      .eq('book_id', params.id)
      .single();
    if (targetErr || !target) {
      return NextResponse.json({ error: 'Target reconciliation not found' }, { status: 404 });
    }
    if (target.account_id !== body.account_id) {
      return NextResponse.json({ error: 'Target rec is on a different bank account.' }, { status: 400 });
    }
    if (target.status === 'reconciled' || target.status === 'abandoned') {
      return NextResponse.json({
        error: `Cannot post into a ${target.status} reconciliation. Reopen it first.`,
      }, { status: 409 });
    }
    imp = { id: target.id };

    // Widen the rec's period to include any new row that falls outside it,
    // mirroring the contribute-lines endpoint's behaviour.
    const patch: Record<string, unknown> = {};
    if (!target.period_start || periodStart < target.period_start) patch.period_start = periodStart;
    if (!target.period_end   || periodEnd   > target.period_end)   patch.period_end   = periodEnd;
    if (Object.keys(patch).length > 0) {
      await supabase.from('bookkeeping_bank_imports').update(patch).eq('id', target.id);
    }
  } else {
    // Synthesise a "file_name" so the dashboard list shows something useful.
    const fileName = `Manual rec · ${periodStart} → ${periodEnd}`;
    const { data: imp2, error: impErr } = await supabase
      .from('bookkeeping_bank_imports')
      .insert({
        book_id: params.id,
        account_id: body.account_id,
        file_name: fileName,
        display_label: body.display_label ?? null,
        period_start: periodStart,
        period_end:   periodEnd,
        opening_balance: null,
        closing_balance: null,
        status: 'in_progress', // bumped to reconciled at the end if every row posted OK
        uploaded_by: ctx.userId,
      })
      .select('id')
      .single();
    if (impErr || !imp2) return NextResponse.json({ error: impErr?.message ?? 'Failed to create import' }, { status: 500 });
    imp = imp2;
  }

  const createdTxnIds: string[] = [];
  const createdLineIds: string[] = [];
  const failures: { row: number; reason: string }[] = [];

  // ── Post each row ──────────────────────────────────────────────────────
  // We iterate postSkipRows (skipped rows removed) but quote the ORIGINAL
  // row index in failure messages so the user can map back to the sheet
  // they filled in.
  for (let i = 0; i < postSkipRows.length; i++) {
    const row = postSkipRows[i];
    const userRowNo = rowsAfterSkip[i].originalIndex + 1;
    const config = TRANSACTION_TYPE_CONFIG[row.type];
    if (!config) { failures.push({ row: userRowNo, reason: `Unknown type ${row.type}` }); continue; }

    // VAT sanity for non-VAT books
    const vat = book.vat_registered ? (row.vat_total ?? 0) : 0;
    const net = round2(row.total - vat);
    if (net < 0) { failures.push({ row: userRowNo, reason: 'Net amount went negative — check VAT.' }); continue; }

    // Build splits using the shared helper. For PAY/CHQ/REC the primary is
    // the bank account; for TRF the primary is the FROM bank (the rec
    // account) and the analysis is the TO bank.
    const splits = buildSplits({
      config,
      primaryAccountId:  body.account_id,
      analysisAccountId: row.analysis_account_id,
      total: row.total,
      vat,
      net,
      vatInputAccountId,
      vatOutputAccountId,
      entryDetails: row.entry_details ?? null,
    });

    // Balance check (paranoia — buildSplits should always return balanced).
    const totalDr = splits.reduce((s, x) => s + x.debit, 0);
    const totalCr = splits.reduce((s, x) => s + x.credit, 0);
    if (Math.abs(totalDr - totalCr) > 0.005) {
      failures.push({ row: userRowNo, reason: `Out of balance: ${totalDr} vs ${totalCr}` });
      continue;
    }

    // Allocate ref atomically.
    const { data: nextSeq, error: seqErr } = await supabase
      .rpc('bookkeeping_next_ref', { p_book_id: params.id, p_type: row.type });
    if (seqErr || typeof nextSeq !== 'number') {
      failures.push({ row: userRowNo, reason: seqErr?.message ?? 'Could not allocate ref' });
      continue;
    }
    const refNo = `${row.type} ${String(nextSeq).padStart(6, '0')}`;

    // Late-entry / VAT lock handling — derive vat_period_override the same way
    // POST /transactions does.
    let vatPeriodOverride: string | null = null;
    if (book.vat_registered && book.vat_lock_date && row.date <= book.vat_lock_date && vat > 0) {
      vatPeriodOverride = addOneDay(book.vat_lock_date as string);
    }

    // Insert header
    const { data: txn, error: txnErr } = await supabase
      .from('bookkeeping_transactions')
      .insert({
        book_id: params.id,
        type: row.type,
        ref_no: refNo,
        ref_seq: nextSeq,
        date: row.date,
        payee_text: row.payee_text ?? null,
        details: row.details ?? null,
        total: row.total,
        vat_total: vat,
        vat_rate: row.vat_rate ?? null,
        vat_treatment: row.vat_treatment ?? null,
        vat_period_override: vatPeriodOverride,
        primary_account_id: body.account_id, // the bank account
        status: 'posted',
        created_by: ctx.userId,
        posted_at: new Date().toISOString(),
      })
      .select('id')
      .single();
    if (txnErr || !txn) {
      failures.push({ row: userRowNo, reason: txnErr?.message ?? 'Header insert failed' });
      continue;
    }
    createdTxnIds.push(txn.id);

    // Insert splits
    const splitRows = splits.map((s, idx) => ({
      transaction_id: txn.id,
      line_no: idx + 1,
      account_id: s.account_id,
      debit: s.debit,
      credit: s.credit,
      entry_details: s.entry_details ?? null,
      notes: s.notes ?? null,
    }));
    const { data: insertedSplits, error: splitsErr } = await supabase
      .from('bookkeeping_transaction_splits')
      .insert(splitRows)
      .select('id, account_id, debit, credit');
    if (splitsErr || !insertedSplits) {
      // Roll back the header so we don't leave an orphaned tx.
      await supabase.from('bookkeeping_transactions').delete().eq('id', txn.id);
      createdTxnIds.pop();
      failures.push({ row: userRowNo, reason: splitsErr?.message ?? 'Split insert failed' });
      continue;
    }

    // Find the bank-side split (the one whose account_id is this rec's bank account)
    // and create a reconciled bank_lines row for it.
    const bankSplit = insertedSplits.find(s => s.account_id === body.account_id);
    if (!bankSplit) {
      // Shouldn't happen — buildSplits always puts the primary first — but
      // be defensive so a single bad row doesn't break the rec session.
      failures.push({ row: userRowNo, reason: 'Bank split not found in inserted splits.' });
      continue;
    }
    const signedAmount = Number(bankSplit.debit) - Number(bankSplit.credit);

    const { data: line, error: lineErr } = await supabase
      .from('bookkeeping_bank_lines')
      .insert({
        import_id: imp.id,
        book_id: params.id,
        account_id: body.account_id,
        line_no: i + 1,
        date: row.date,
        description: row.payee_text ?? row.details ?? refNo,
        amount: signedAmount,
        matched_split_id: bankSplit.id,
        reconciled_at: new Date().toISOString(),
        reconciled_by: ctx.userId,
      })
      .select('id')
      .single();
    if (lineErr || !line) {
      failures.push({ row: userRowNo, reason: lineErr?.message ?? 'Bank line insert failed' });
      continue;
    }
    // Also stamp the bank split's cleared_in_rec_id so the period-first
    // model + legacy bank_lines link stay in sync. The complete-rec gap
    // check reads from cleared_in_rec_id only.
    await supabase
      .from('bookkeeping_transaction_splits')
      .update({ cleared_in_rec_id: imp.id, cleared_at: new Date().toISOString() })
      .eq('id', bankSplit.id);
    createdLineIds.push(line.id);
  }

  // If EVERY row failed:
  //   • if we just created the rec, delete it so it doesn't sit there empty
  //   • if we attached to an existing rec, leave it alone (it had other
  //     work in it; we just couldn't add to it)
  if (createdTxnIds.length === 0) {
    if (!body.existing_import_id) {
      await supabase.from('bookkeeping_bank_imports').delete().eq('id', imp.id);
    }
    return NextResponse.json({
      error: 'No rows could be posted.',
      failures,
    }, { status: 400 });
  }

  // Mark import reconciled when every row landed cleanly — but ONLY when
  // this call created the rec. Contributions into an existing active rec
  // leave the status alone (the user clicks Reconcile period themselves).
  const allOk = failures.length === 0;
  if (allOk && !body.existing_import_id) {
    await supabase
      .from('bookkeeping_bank_imports')
      .update({ status: 'reconciled', reconciled_at: new Date().toISOString(), reconciled_by: ctx.userId })
      .eq('id', imp.id);
  }

  // Audit one entry per posted transaction so the audit log mirrors the
  // single-post route's behaviour.
  if (createdTxnIds.length > 0) {
    await supabase.from('bookkeeping_audit').insert(
      createdTxnIds.map(txnId => ({
        book_id: params.id,
        user_id: ctx.userId,
        entity_type: 'transaction',
        entity_id: txnId,
        action: 'create',
        diff: { via: 'manual_bank_rec', import_id: imp.id },
      })),
    );
  }

  return NextResponse.json({
    import_id: imp.id,
    posted_rows: createdTxnIds.length,
    reconciled_lines: createdLineIds.length,
    failures,
    status: allOk ? 'reconciled' : 'in_progress',
  });
}

function round2(n: number): number { return Math.round(n * 100) / 100; }
function addOneDay(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
