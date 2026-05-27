import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { getBookkeepingContext } from '@/lib/bookkeeping/server';
import type { ParsedTransaction } from '@/lib/bookkeeping/vtTransactionReportParser';
import type { TransactionType } from '@/types/bookkeeping';

// ── /api/bookkeeping/books/[id]/imports/[importId] ──────────────────────────
// GET    → the full import row including parsed_rows (for the preview screen).
// POST   → commit the import: create any missing accounts, then insert every
//          transaction + splits, tagged with import_id. Advances ref counters.
// DELETE → rollback: delete every transaction with this import_id. Marks the
//          import row status='rolled_back'.
//
// All three are admin-only. POST is also gated on status='pending' so a user
// can't accidentally post the same import twice; DELETE is gated on
// status='posted'.

export const runtime = 'nodejs';
// The post step can take a few seconds on a 5k-row file. Bump the timeout so
// Vercel doesn't kill the request mid-batch.
export const maxDuration = 60;

const SELECT_FULL = `
  id, book_id, file_name, status, summary, parsed_rows,
  created_at, posted_at, rolled_back_at,
  uploaded_by, uploader:users!bookkeeping_imports_uploaded_by_fkey(id, full_name, email)
`;

// ── GET ─────────────────────────────────────────────────────────────────────
export async function GET(_req: NextRequest, { params }: { params: { id: string; importId: string } }) {
  const ctx = await getBookkeepingContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const supabase = createClient();
  const { data: book } = await supabase
    .from('bookkeeping_books').select('id').eq('id', params.id).eq('firm_id', ctx.firmId).single();
  if (!book) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const { data, error } = await supabase
    .from('bookkeeping_imports')
    .select(SELECT_FULL)
    .eq('id', params.importId)
    .eq('book_id', params.id)
    .single();
  if (error || !data) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ import: data });
}

// ── POST (commit) ───────────────────────────────────────────────────────────
export async function POST(_req: NextRequest, { params }: { params: { id: string; importId: string } }) {
  const ctx = await getBookkeepingContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  if (ctx.userRole !== 'admin') {
    return NextResponse.json({ error: 'Only admins can commit a bulk import.' }, { status: 403 });
  }

  const supabase = createClient();
  const { data: book } = await supabase
    .from('bookkeeping_books').select('id, admin_locked').eq('id', params.id).eq('firm_id', ctx.firmId).single();
  if (!book) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const { data: imp, error: impErr } = await supabase
    .from('bookkeeping_imports')
    .select('id, book_id, status, parsed_rows, summary')
    .eq('id', params.importId)
    .eq('book_id', params.id)
    .single();
  if (impErr || !imp) return NextResponse.json({ error: 'Import not found' }, { status: 404 });
  if (imp.status !== 'pending') {
    return NextResponse.json({ error: `Import is in status "${imp.status}" — can only post a pending import.` }, { status: 409 });
  }

  const parsed = imp.parsed_rows as { transactions: ParsedTransaction[] } | null;
  if (!parsed || !Array.isArray(parsed.transactions) || parsed.transactions.length === 0) {
    return NextResponse.json({ error: 'No transactions to post.' }, { status: 400 });
  }
  const transactions = parsed.transactions;

  // Refuse if any transaction has unresolved errors — the user should fix the
  // source file and re-upload rather than posting a half-broken set.
  const errored = transactions.filter(t => t.errors.length > 0);
  if (errored.length > 0) {
    return NextResponse.json(
      {
        error: 'fix_source_first',
        message: `${errored.length} transactions have errors (e.g. unbalanced or malformed). Fix the source file and re-upload.`,
        examples: errored.slice(0, 5).map(t => ({ ref: t.originalRef, errors: t.errors })),
      },
      { status: 400 },
    );
  }

  await supabase.from('bookkeeping_imports')
    .update({ status: 'posting' }).eq('id', params.importId);

  try {
    // ── 1. Create any missing accounts ──────────────────────────────────────
    // We dedupe on (ledger, account_name) from the parsed COA. Inserts use
    // ON CONFLICT DO NOTHING via a per-row insert with onConflict-style
    // ignore; PostgREST doesn't support ON CONFLICT natively, so we fetch
    // existing first, then insert only the diff.
    const { data: existing } = await supabase
      .from('bookkeeping_accounts')
      .select('id, name, ledger')
      .eq('book_id', params.id);
    const existingByDisplay = new Map<string, string>(); // "Ledger: Name" → id
    for (const a of existing ?? []) {
      existingByDisplay.set(`${a.ledger ?? ''}: ${a.name}`, a.id);
    }

    const coaDetail = (imp.summary as { coa_detail?: Array<{
      display: string; ledger: string; accountName: string;
      inferredAccountType: 'asset' | 'liability' | 'equity' | 'income' | 'expense';
    }> })?.coa_detail ?? [];
    const toCreate = coaDetail.filter(c => !existingByDisplay.has(c.display));

    if (toCreate.length > 0) {
      // Spread the sort_order so new accounts within a ledger keep parser
      // order. We don't need precise ordering — anything that pushes them
      // past existing accounts is fine.
      const rows = toCreate.map((c, i) => ({
        book_id: params.id,
        name: c.accountName,
        ledger: c.ledger,
        account_type: c.inferredAccountType,
        sort_order: 1000 + i,
      }));
      const { data: inserted, error: insErr } = await supabase
        .from('bookkeeping_accounts')
        .insert(rows)
        .select('id, name, ledger');
      if (insErr) throw new Error(`Couldn't create accounts: ${insErr.message}`);
      for (const a of inserted ?? []) {
        existingByDisplay.set(`${a.ledger ?? ''}: ${a.name}`, a.id);
      }
    }

    // ── 2. Allocate ref sequences ────────────────────────────────────────────
    // For passthrough types we want to preserve VT's original seq (e.g.
    // PAY 001528 stays PAY 001528). To avoid colliding with whatever's
    // already in the book, we check the existing max ref_seq per type and
    // shift the imported batch UP if needed.
    //
    // For remapped types (CTX→REC, PCV→PAY, VAT→JRN…) we allocate fresh
    // seqs from the existing counter.
    const byType: Record<string, ParsedTransaction[]> = {};
    for (const t of transactions) {
      (byType[t.type] ??= []).push(t);
    }

    for (const [type, list] of Object.entries(byType)) {
      // Find SMITH's current max for this type.
      const { data: maxRow } = await supabase
        .from('bookkeeping_transactions')
        .select('ref_seq')
        .eq('book_id', params.id)
        .eq('type', type)
        .order('ref_seq', { ascending: false })
        .limit(1)
        .maybeSingle();
      const existingMax = (maxRow?.ref_seq as number | undefined) ?? 0;

      // Group: passthrough (originalRefIfRemapped null) vs remapped.
      const passthrough = list.filter(t => !t.originalRefIfRemapped);
      const remapped    = list.filter(t =>  t.originalRefIfRemapped);

      // For passthrough: keep original seqs but shift the entire block up
      // by `existingMax + 1 - min(originalSeq)` if any would collide. This
      // preserves the RELATIVE numbering so audit trails to VT still make
      // sense even when shifted.
      if (passthrough.length > 0) {
        const minSeq = Math.min(...passthrough.map(t => t.refSeq));
        const shift = existingMax >= minSeq ? existingMax + 1 - minSeq : 0;
        if (shift > 0) {
          for (const t of passthrough) {
            // Record the original ref in a tag so it's still findable.
            t.originalRefIfRemapped = t.refNo;
            t.refSeq = t.refSeq + shift;
            t.refNo = `${type} ${String(t.refSeq).padStart(6, '0')}`;
          }
        }
      }

      // For remapped: allocate fresh, starting just past everything we've
      // assigned above (existingMax + passthrough count, then start there).
      let nextSeq = Math.max(
        existingMax,
        ...passthrough.map(t => t.refSeq).concat([0]),
      ) + 1;
      for (const t of remapped) {
        t.refSeq = nextSeq++;
        t.refNo = `${type} ${String(t.refSeq).padStart(6, '0')}`;
      }
    }

    // ── 3. Insert transactions in batches ───────────────────────────────────
    // We insert headers first (need their ids back), then splits.
    const HEADER_BATCH = 200;
    const SPLIT_BATCH = 500;
    const txnIdByOriginalRef = new Map<string, string>();

    for (let i = 0; i < transactions.length; i += HEADER_BATCH) {
      const slice = transactions.slice(i, i + HEADER_BATCH);
      const headerRows = slice.map(t => ({
        book_id: params.id,
        type: t.type,
        ref_no: t.refNo,
        ref_seq: t.refSeq,
        date: t.date,
        payee_text: null,
        details: t.details,
        notes: t.originalRefIfRemapped
          ? `${t.notes ? t.notes + '\n\n' : ''}Imported from VT — original ref: ${t.originalRefIfRemapped}`
          : t.notes,
        total: Math.max(
          t.splits.reduce((s, x) => s + x.debit, 0),
          t.splits.reduce((s, x) => s + x.credit, 0),
        ),
        vat_total: 0,
        vat_rate: null,
        vat_treatment: 'no_vat' as const,
        primary_account_id: null,
        status: 'posted' as const,
        created_by: ctx.userId,
        posted_at: new Date().toISOString(),
        import_id: params.importId,
      }));
      const { data: inserted, error: hErr } = await supabase
        .from('bookkeeping_transactions')
        .insert(headerRows)
        .select('id, ref_no');
      if (hErr) throw new Error(`Header batch ${i}-${i + slice.length}: ${hErr.message}`);
      for (const r of inserted ?? []) {
        // Find the original parsed txn by ref_no to map back its splits.
        const match = slice.find(t => t.refNo === r.ref_no);
        if (match) txnIdByOriginalRef.set(match.originalRef, r.id);
      }
    }

    // Build the splits payload using the new txn ids.
    const splitRows: Array<{
      transaction_id: string; line_no: number; account_id: string;
      debit: number; credit: number; entry_details: string | null; notes: string | null;
    }> = [];
    for (const t of transactions) {
      const txnId = txnIdByOriginalRef.get(t.originalRef);
      if (!txnId) continue; // shouldn't happen but skip rather than crash
      t.splits.forEach((s, i) => {
        const accountId = existingByDisplay.get(s.accountDisplay);
        if (!accountId) {
          throw new Error(`Account "${s.accountDisplay}" missing after COA seed — aborting.`);
        }
        splitRows.push({
          transaction_id: txnId,
          line_no: i + 1,
          account_id: accountId,
          debit: s.debit,
          credit: s.credit,
          entry_details: s.entryDetails,
          notes: s.marker ?? null,
        });
      });
    }

    for (let i = 0; i < splitRows.length; i += SPLIT_BATCH) {
      const slice = splitRows.slice(i, i + SPLIT_BATCH);
      const { error: sErr } = await supabase
        .from('bookkeeping_transaction_splits')
        .insert(slice);
      if (sErr) throw new Error(`Split batch ${i}-${i + slice.length}: ${sErr.message}`);
    }

    // ── 4. Advance ref counters past everything we've inserted ──────────────
    // bookkeeping_next_ref reads from bookkeeping_ref_counters; we need to
    // make sure the next ref the user posts manually doesn't collide.
    for (const [type, list] of Object.entries(byType)) {
      const maxSeq = Math.max(...list.map(t => t.refSeq));
      // Upsert via the existing RPC pattern would be ideal but we don't have
      // one — do it directly. next_seq must be > maxSeq for the next
      // bookkeeping_next_ref call to skip past us.
      const { data: counter } = await supabase
        .from('bookkeeping_ref_counters')
        .select('next_seq')
        .eq('book_id', params.id).eq('type', type).maybeSingle();
      const newNext = Math.max((counter?.next_seq as number | undefined) ?? 0, maxSeq + 1);
      if (counter) {
        await supabase.from('bookkeeping_ref_counters')
          .update({ next_seq: newNext })
          .eq('book_id', params.id).eq('type', type);
      } else {
        await supabase.from('bookkeeping_ref_counters')
          .insert({ book_id: params.id, type, next_seq: newNext });
      }
    }

    // ── 5. Mark import as posted ────────────────────────────────────────────
    await supabase.from('bookkeeping_imports')
      .update({
        status: 'posted',
        posted_at: new Date().toISOString(),
        parsed_rows: null,  // free the JSONB — transactions are the source now
      })
      .eq('id', params.importId);

    await supabase.from('bookkeeping_audit').insert({
      book_id: params.id,
      user_id: ctx.userId,
      entity_type: 'book',
      entity_id: params.id,
      action: 'create',
      diff: { imported: transactions.length, import_id: params.importId },
    });

    return NextResponse.json({ ok: true, posted: transactions.length });
  } catch (e) {
    // Anything went wrong → flip back to errored. We deliberately DON'T
    // try to delete partial inserts here — a follow-up rollback DELETE will
    // clean up via import_id.
    await supabase.from('bookkeeping_imports')
      .update({ status: 'errored', summary: { ...(imp.summary as object ?? {}), error: String(e) } })
      .eq('id', params.importId);
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Post failed' }, { status: 500 });
  }
}

// ── DELETE (rollback) ───────────────────────────────────────────────────────
export async function DELETE(_req: NextRequest, { params }: { params: { id: string; importId: string } }) {
  const ctx = await getBookkeepingContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  if (ctx.userRole !== 'admin') {
    return NextResponse.json({ error: 'Only admins can roll back a bulk import.' }, { status: 403 });
  }

  const supabase = createClient();
  const { data: book } = await supabase
    .from('bookkeeping_books').select('id').eq('id', params.id).eq('firm_id', ctx.firmId).single();
  if (!book) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const { data: imp, error: impErr } = await supabase
    .from('bookkeeping_imports')
    .select('id, status')
    .eq('id', params.importId).eq('book_id', params.id).single();
  if (impErr || !imp) return NextResponse.json({ error: 'Import not found' }, { status: 404 });

  // We allow rollback from posted OR errored — errored may have left a
  // partial set of inserts that the user wants gone.
  if (imp.status !== 'posted' && imp.status !== 'errored') {
    return NextResponse.json({ error: `Can't roll back an import in status "${imp.status}".` }, { status: 409 });
  }

  // Cascade-delete via the FK — split rows cascade from their txn,
  // matches won't exist yet on freshly imported entries (no rec to roll back).
  const { error: delErr, count } = await supabase
    .from('bookkeeping_transactions')
    .delete({ count: 'exact' })
    .eq('import_id', params.importId)
    .eq('book_id', params.id);
  if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 });

  await supabase.from('bookkeeping_imports')
    .update({ status: 'rolled_back', rolled_back_at: new Date().toISOString() })
    .eq('id', params.importId);

  await supabase.from('bookkeeping_audit').insert({
    book_id: params.id,
    user_id: ctx.userId,
    entity_type: 'book',
    entity_id: params.id,
    action: 'delete',
    diff: { rolled_back_import: params.importId, deleted_transactions: count ?? 0 },
  });

  return NextResponse.json({ ok: true, deleted: count ?? 0 });
}
