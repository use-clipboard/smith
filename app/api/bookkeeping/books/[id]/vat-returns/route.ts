import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase-server';
import { getBookkeepingContext } from '@/lib/bookkeeping/server';
import { computeVatReturn } from '@/lib/bookkeeping/vatReturn';

// ── POST /api/bookkeeping/books/[id]/vat-returns ────────────────────────────
// File a VAT return for the given period. The server RECOMPUTES the 9-box
// figures from scratch (never trusts client-supplied figures), captures the
// full transaction breakdown into the snapshot column for audit, AND posts a
// closing journal that zeros the VAT control accounts and moves the net to
// "Net VAT due" — matching VT's accounting treatment.
//
// Body: { from, to, filing_date?, hmrc_reference?, notes?, lock_period,
//         submitted_at?, submission_method? }
//
// ── GET /api/bookkeeping/books/[id]/vat-returns ─────────────────────────────
// List every filed return for a book (newest first).

const FileBody = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to:   z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  filing_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  hmrc_reference: z.string().max(80).nullable().optional(),
  notes: z.string().max(1000).nullable().optional(),
  lock_period: z.boolean().default(true),
  /** ISO date — when the return was actually submitted to HMRC. Optional;
   *  null means "not yet submitted" or "submitted same day as filed". */
  submitted_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  submission_method: z.enum(['manual', 'mtd_api']).nullable().optional(),
});

const RETURN_SELECT = `
  id, book_id, ref_no, ref_seq, period_from, period_to,
  box1, box2, box3, box4, box5, box6, box7, box8, box9,
  late_entry_vat,
  filed_at, filed_by, submitted_at, submission_method,
  hmrc_reference, notes, filing_journal_id,
  filed_by_user:users!bookkeeping_vat_returns_filed_by_fkey(id, full_name, email),
  created_at, updated_at
`;

interface FiledByUserRow {
  id: string;
  full_name: string | null;
  email: string | null;
}

function shape(row: unknown) {
  const r = row as Record<string, unknown> & { filed_by_user?: FiledByUserRow | FiledByUserRow[] | null };
  const fbu = Array.isArray(r.filed_by_user) ? r.filed_by_user[0] : r.filed_by_user;
  const filedByName = fbu?.full_name ?? fbu?.email ?? null;
  const { filed_by_user, ...rest } = r;
  void filed_by_user;
  return { ...rest, filed_by_name: filedByName };
}

// ── POST: file ─────────────────────────────────────────────────────────────
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getBookkeepingContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  let body: z.infer<typeof FileBody>;
  try { body = FileBody.parse(await req.json()); }
  catch (e) { return NextResponse.json({ error: 'Invalid payload', detail: String(e) }, { status: 400 }); }
  if (body.to < body.from) {
    return NextResponse.json({ error: '"to" must be on or after "from"' }, { status: 400 });
  }

  const supabase = createClient();
  const { data: book, error: bookErr } = await supabase
    .from('bookkeeping_books')
    .select('id, firm_id, vat_registered, vat_scheme, vat_lock_date')
    .eq('id', params.id)
    .eq('firm_id', ctx.firmId)
    .single();
  if (bookErr || !book) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (!book.vat_registered) {
    return NextResponse.json({ error: 'This book is not VAT-registered.' }, { status: 400 });
  }

  // Recompute from scratch (server-side source of truth).
  let figures;
  try {
    figures = await computeVatReturn(supabase, params.id, body.from, body.to);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Compute failed' }, { status: 500 });
  }

  const filingDate = body.filing_date ?? new Date().toISOString().slice(0, 10);
  const submittedAtIso = body.submitted_at ? `${body.submitted_at}T00:00:00.000Z` : null;

  // ── Allocate sequential VAT ref ───────────────────────────────────────────
  const { data: nextSeqData, error: seqErr } = await supabase
    .rpc('bookkeeping_next_ref', { p_book_id: params.id, p_type: 'VAT' });
  if (seqErr || typeof nextSeqData !== 'number') {
    return NextResponse.json({ error: seqErr?.message ?? 'Could not allocate VAT ref' }, { status: 500 });
  }
  const refSeq = nextSeqData;
  const refNo = `VAT ${String(refSeq).padStart(6, '0')}`;

  // ── Post the closing journal (VT-style "transfer transaction") ────────────
  // DR VAT-Output (clear the credit balance built up)
  // CR VAT-Input  (clear the debit balance built up)
  // Net (Box 5) → Net VAT due (CR if positive = we owe; DR if negative = HMRC owes)
  //
  // We look up the three control accounts by name within the Creditors ledger
  // (matches the LTD COA seed). If any is missing — e.g. an older book — we
  // skip the journal and continue with filing-only; the figures still record.
  let filingJournalId: string | null = null;
  let journalWarning: string | null = null;
  try {
    const { data: vatAccts } = await supabase
      .from('bookkeeping_accounts')
      .select('id, name')
      .eq('book_id', params.id)
      .eq('ledger', 'Creditors')
      .in('name', ['VAT - Input', 'VAT - Output', 'Net VAT due']);
    const accts = new Map((vatAccts ?? []).map(a => [a.name as string, a.id as string]));
    const outAcct = accts.get('VAT - Output');
    const inAcct  = accts.get('VAT - Input');
    const netAcct = accts.get('Net VAT due');
    if (outAcct && inAcct && netAcct) {
      const splits: Array<{
        account_id: string; debit: number; credit: number;
        entry_details: string;
      }> = [];
      if (figures.box1 !== 0) {
        splits.push({ account_id: outAcct, debit: figures.box1, credit: 0,
          entry_details: `${refNo} — clear output VAT (Box 1)` });
      }
      if (figures.box4 !== 0) {
        splits.push({ account_id: inAcct, debit: 0, credit: figures.box4,
          entry_details: `${refNo} — clear input VAT (Box 4)` });
      }
      if (figures.box5 > 0) {
        splits.push({ account_id: netAcct, debit: 0, credit: figures.box5,
          entry_details: `${refNo} — net VAT due to HMRC` });
      } else if (figures.box5 < 0) {
        splits.push({ account_id: netAcct, debit: -figures.box5, credit: 0,
          entry_details: `${refNo} — net VAT recoverable from HMRC` });
      }

      if (splits.length >= 2) {
        // Allocate JRN ref for the closing journal
        const { data: jrnSeq, error: jrnSeqErr } = await supabase
          .rpc('bookkeeping_next_ref', { p_book_id: params.id, p_type: 'JRN' });
        if (jrnSeqErr || typeof jrnSeq !== 'number') {
          journalWarning = `Could not allocate JRN ref for closing journal: ${jrnSeqErr?.message ?? 'unknown'}`;
        } else {
          const jrnRefNo = `JRN ${String(jrnSeq).padStart(6, '0')}`;
          const { data: jrn, error: jrnErr } = await supabase
            .from('bookkeeping_transactions')
            .insert({
              book_id: params.id,
              type: 'JRN',
              ref_no: jrnRefNo,
              ref_seq: jrnSeq,
              date: body.to,                    // closing journal dated at period end
              payee_text: null,
              details: `${refNo} — VAT return for ${body.from} to ${body.to}`,
              total: Math.max(figures.box1, figures.box4),
              vat_total: 0,
              vat_rate: null,
              vat_treatment: null,
              primary_account_id: null,
              status: 'posted',
              created_by: ctx.userId,
              posted_at: new Date().toISOString(),
            })
            .select('id')
            .single();
          if (jrnErr || !jrn) {
            journalWarning = `Could not post closing journal: ${jrnErr?.message ?? 'unknown'}`;
          } else {
            const splitRows = splits.map((s, i) => ({
              transaction_id: jrn.id,
              line_no: i + 1,
              account_id: s.account_id,
              debit: s.debit,
              credit: s.credit,
              entry_details: s.entry_details,
              notes: null,
            }));
            const { error: splitsErr } = await supabase
              .from('bookkeeping_transaction_splits')
              .insert(splitRows);
            if (splitsErr) {
              // Roll back the journal header — splits failed, the transaction is inconsistent.
              await supabase.from('bookkeeping_transactions').delete().eq('id', jrn.id);
              journalWarning = `Closing journal split insert failed: ${splitsErr.message}`;
            } else {
              filingJournalId = jrn.id;
            }
          }
        }
      }
    } else {
      const missing = ['VAT - Input', 'VAT - Output', 'Net VAT due'].filter(n => !accts.has(n));
      journalWarning = `Closing journal not posted — missing accounts in Creditors ledger: ${missing.join(', ')}.`;
    }
  } catch (e) {
    journalWarning = e instanceof Error ? e.message : 'Closing journal failed';
  }

  // ── Insert the filing record ──────────────────────────────────────────────
  const { data: filed, error: insErr } = await supabase
    .from('bookkeeping_vat_returns')
    .insert({
      book_id: params.id,
      ref_no: refNo,
      ref_seq: refSeq,
      period_from: body.from,
      period_to: body.to,
      box1: figures.box1, box2: figures.box2, box3: figures.box3,
      box4: figures.box4, box5: figures.box5,
      box6: figures.box6, box7: figures.box7, box8: figures.box8, box9: figures.box9,
      late_entry_vat: figures.late_entry_vat,
      filed_at: `${filingDate}T${new Date().toISOString().slice(11)}`,
      filed_by: ctx.userId,
      submitted_at: submittedAtIso,
      submission_method: body.submission_method ?? null,
      hmrc_reference: body.hmrc_reference ?? null,
      notes: body.notes ?? null,
      filing_journal_id: filingJournalId,
      snapshot: {
        vat_scheme: book.vat_scheme,
        outputs: figures.outputs,
        inputs:  figures.inputs,
        late_entry_breakdown: [...figures.outputs, ...figures.inputs].filter(r => r.is_late_entry),
      },
    })
    .select(RETURN_SELECT)
    .single();
  if (insErr || !filed) {
    // Best-effort rollback of the closing journal if filing record failed
    if (filingJournalId) {
      await supabase.from('bookkeeping_transactions').delete().eq('id', filingJournalId);
    }
    return NextResponse.json({ error: insErr?.message ?? 'Insert failed' }, { status: 500 });
  }

  // Advance the VAT lock if requested and the new period_to is later.
  if (body.lock_period) {
    const currentLock = book.vat_lock_date as string | null;
    if (!currentLock || body.to > currentLock) {
      const { error: lockErr } = await supabase
        .from('bookkeeping_books')
        .update({ vat_lock_date: body.to })
        .eq('id', params.id);
      if (lockErr) {
        console.error('[bookkeeping] failed to advance vat_lock_date', lockErr);
      }
    }
  }

  // Audit
  await supabase.from('bookkeeping_audit').insert({
    book_id: params.id,
    user_id: ctx.userId,
    entity_type: 'vat_return',
    entity_id: filed.id,
    action: 'create',
    diff: {
      ref_no: refNo,
      period: `${body.from} to ${body.to}`,
      box5: figures.box5,
      hmrc_reference: body.hmrc_reference ?? null,
      submitted_at: submittedAtIso,
      late_entry_vat: figures.late_entry_vat,
      filing_journal_id: filingJournalId,
      lock_period: body.lock_period,
    },
  });

  return NextResponse.json({
    vat_return: shape(filed),
    journal_warning: journalWarning,
  });
}

// ── GET: list ──────────────────────────────────────────────────────────────
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getBookkeepingContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const supabase = createClient();
  const { data: book, error: bookErr } = await supabase
    .from('bookkeeping_books')
    .select('id, firm_id')
    .eq('id', params.id)
    .eq('firm_id', ctx.firmId)
    .single();
  if (bookErr || !book) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const { data, error } = await supabase
    .from('bookkeeping_vat_returns')
    .select(RETURN_SELECT)
    .eq('book_id', params.id)
    .order('period_to', { ascending: false })
    .order('filed_at', { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ vat_returns: (data ?? []).map(shape) });
}
