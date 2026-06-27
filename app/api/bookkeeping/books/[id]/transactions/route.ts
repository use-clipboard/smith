import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase-server';
import { getBookkeepingContext } from '@/lib/bookkeeping/server';

const TRANSACTION_TYPES = ['PAY','CHQ','REC','SIN','SCR','PIN','PCR','JRN','TRF','RJN','WOF','WBK','YET','DVT'] as const;
const VAT_TREATMENTS = ['no_vat','standard_20','reduced_5','zero','exempt','outside_scope'] as const;

// Each split is exclusively a debit OR a credit. We accept zero on either
// side but reject both-positive.
const SplitSchema = z.object({
  account_id: z.string().uuid(),
  debit: z.number().min(0).default(0),
  credit: z.number().min(0).default(0),
  entry_details: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  /** Charity fund this line belongs to (NULL on non-charity books). */
  fund_id: z.string().uuid().nullable().optional(),
}).refine(s => s.debit === 0 || s.credit === 0, {
  message: 'A split cannot be both a debit and a credit',
});

const CreateBody = z.object({
  type: z.enum(TRANSACTION_TYPES),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD'),
  payee_text: z.string().max(200).nullable().optional(),
  details: z.string().max(500).nullable().optional(),
  total: z.number().min(0),
  vat_total: z.number().min(0).default(0),
  vat_rate: z.number().min(0).max(100).nullable().optional(),
  vat_treatment: z.enum(VAT_TREATMENTS).nullable().optional(),
  primary_account_id: z.string().uuid().nullable().optional(),
  splits: z.array(SplitSchema).min(1),
  /** Required when type === 'RJN'. The date the auto-reversal entry will be posted on. */
  reverses_on_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  /** Late-entry flag — the user has acknowledged the transaction's date falls
   *  in a filed VAT period and wants its VAT to be carried into the next
   *  return. The server sets vat_period_override accordingly. */
  late_entry: z.boolean().optional(),
  /** Flat Rate Scheme — purchase is a reclaimable capital asset (input VAT
   *  recoverable into Box 4 despite FRS). */
  frs_capital_reclaim: z.boolean().optional(),
});

/** Add one day to a YYYY-MM-DD string. */
function addOneDay(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

const TX_SELECT = `
  id, book_id, type, ref_no, ref_seq, date, payee_text, details,
  total, vat_total, vat_rate, vat_treatment, vat_period_override,
  primary_account_id, frs_capital_reclaim, status, created_by, created_at, updated_at, posted_at,
  primary_account:bookkeeping_accounts!bookkeeping_transactions_primary_account_id_fkey(id, name, ledger, account_type),
  splits:bookkeeping_transaction_splits(
    id, transaction_id, line_no, account_id, debit, credit, entry_details, notes, fund_id,
    account:bookkeeping_accounts(id, name, ledger, account_type),
    fund:bookkeeping_funds(id, name, fund_type)
  )
`;

// ── GET /api/bookkeeping/books/[id]/transactions ─────────────────────────────
// List transactions for a book. Most recent first by default.
//   ?limit=N (default 100, max 10000 — bulk-imported books can have several
//             thousand rows and the Home recent-feed asks for them all)
//   ?type=PAY
//   ?account_id=… (transactions touching this account in any split)
//   ?date_from=YYYY-MM-DD
//   ?date_to=YYYY-MM-DD
//   ?order=asc|desc (default desc, used by ledger drill-downs which want
//                    chronological running balance)
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getBookkeepingContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const url = new URL(req.url);
  const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '100', 10) || 100, 10000);
  const type  = url.searchParams.get('type');
  const accountId = url.searchParams.get('account_id');
  const dateFrom = url.searchParams.get('date_from');
  const dateTo   = url.searchParams.get('date_to');
  const order = url.searchParams.get('order') === 'asc' ? 'asc' : 'desc';

  const supabase = createClient();
  const { data: book, error: bookErr } = await supabase
    .from('bookkeeping_books')
    .select('id, firm_id')
    .eq('id', params.id)
    .eq('firm_id', ctx.firmId)
    .single();
  if (bookErr || !book) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // Supabase / PostgREST caps single-query results at the project "Max Rows"
  // setting (1000 by default). When the caller asks for more, we have to
  // page through with .range() and concatenate. The book's home recent feed
  // requests limit=10000 to mean "show everything", so we honour that here.
  const PAGE_SIZE = 1000;

  type Row = unknown;
  const allRows: Row[] = [];
  let accountFilterIds: string[] | null = null;

  if (accountId) {
    // To filter by account that appears in any split, fetch ids first then filter.
    // PostgREST can't do a "transactions whose splits include account X" filter
    // in one query, so use a two-step approach. Split ids may number in the
    // thousands too — page through them as well.
    const splitIds = new Set<string>();
    let from = 0;
    while (true) {
      const { data: splitRows, error: splitErr } = await supabase
        .from('bookkeeping_transaction_splits')
        .select('transaction_id')
        .eq('account_id', accountId)
        .range(from, from + PAGE_SIZE - 1);
      if (splitErr) return NextResponse.json({ error: splitErr.message }, { status: 500 });
      for (const r of splitRows ?? []) splitIds.add(r.transaction_id as string);
      if (!splitRows || splitRows.length < PAGE_SIZE) break;
      from += PAGE_SIZE;
    }
    accountFilterIds = [...splitIds];
    if (accountFilterIds.length === 0) return NextResponse.json({ transactions: [] });
  }

  // Page through transactions until we've fetched `limit` rows (or run out).
  let from = 0;
  while (allRows.length < limit) {
    const remaining = limit - allRows.length;
    const pageSize = Math.min(PAGE_SIZE, remaining);
    let q = supabase
      .from('bookkeeping_transactions')
      .select(TX_SELECT)
      .eq('book_id', params.id)
      .order('date', { ascending: order === 'asc' })
      .order('created_at', { ascending: order === 'asc' })
      .range(from, from + pageSize - 1);

    if (type) q = q.eq('type', type);
    if (dateFrom) q = q.gte('date', dateFrom);
    if (dateTo)   q = q.lte('date', dateTo);
    // PostgREST has a practical URL-length limit on .in() — if we ever needed
    // to filter by tens of thousands of ids we'd batch. For now (one account's
    // splits) the size is manageable.
    if (accountFilterIds) q = q.in('id', accountFilterIds);

    const { data, error } = await q;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    const rows = data ?? [];
    allRows.push(...rows);
    if (rows.length < pageSize) break; // exhausted the table
    from += pageSize;
  }

  return NextResponse.json({ transactions: allRows });
}

// ── POST /api/bookkeeping/books/[id]/transactions ────────────────────────────
// Create one transaction with its splits. Atomically allocates the next ref
// via the bookkeeping_next_ref(book, type) SQL function.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getBookkeepingContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  let body: z.infer<typeof CreateBody>;
  try { body = CreateBody.parse(await req.json()); }
  catch (e) { return NextResponse.json({ error: 'Invalid payload', detail: String(e) }, { status: 400 }); }

  // RJN-specific validation: the reversal date is mandatory and must be after
  // the original date (otherwise the books would unwind themselves).
  if (body.type === 'RJN') {
    if (!body.reverses_on_date) {
      return NextResponse.json({ error: 'Reversing journals need a reversal date.' }, { status: 400 });
    }
    if (body.reverses_on_date <= body.date) {
      return NextResponse.json({ error: 'The reversal date must be after the journal date.' }, { status: 400 });
    }
  }

  const supabase = createClient();
  // Book existence + lock + period checks (we read these once).
  const { data: book, error: bookErr } = await supabase
    .from('bookkeeping_books')
    .select('id, firm_id, admin_locked, period_lock_date, vat_lock_date, vat_registered')
    .eq('id', params.id)
    .eq('firm_id', ctx.firmId)
    .single();
  if (bookErr || !book) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const isAdmin = ctx.userRole === 'admin';
  if (book.admin_locked && !isAdmin) {
    return NextResponse.json({ error: 'Book is admin-locked' }, { status: 403 });
  }
  if (book.period_lock_date && body.date <= book.period_lock_date && !isAdmin) {
    return NextResponse.json(
      { error: `Date is on or before the period lock (${book.period_lock_date})` },
      { status: 403 },
    );
  }

  // ── VAT late-entry handling ──────────────────────────────────────────────
  // If the txn's date falls in a filed VAT period (date <= vat_lock_date) we
  // require the client to either acknowledge it as a late entry (late_entry =
  // true) OR not be carrying VAT at all (zero vat_total). Late-entry txns get
  // a vat_period_override set server-side to the first day of the current
  // unfiled VAT period — they show in their real month for P&L/BS, but the
  // next VAT return picks up the VAT.
  let vatPeriodOverride: string | null = null;
  const carriesVat = (body.vat_total ?? 0) > 0;
  if (
    book.vat_registered &&
    book.vat_lock_date &&
    body.date <= book.vat_lock_date &&
    carriesVat
  ) {
    if (!body.late_entry) {
      return NextResponse.json(
        {
          error: 'late_entry_required',
          message: `${body.date} falls in a filed VAT period (locked through ${book.vat_lock_date}). Tick "Include in next VAT return" to post as a late entry.`,
          vat_lock_date: book.vat_lock_date,
        },
        { status: 409 },
      );
    }
    // Server computes the override — first day of the current unfiled VAT period.
    vatPeriodOverride = addOneDay(book.vat_lock_date);
  }

  // VAT guard: a non-VAT book has no VAT ledgers, so VAT data is meaningless.
  // Silently strip rather than reject — the client may send 0/null already.
  if (!book.vat_registered) {
    if (body.vat_total > 0 || (body.vat_rate ?? 0) > 0 || (body.vat_treatment && body.vat_treatment !== 'no_vat')) {
      return NextResponse.json(
        { error: 'This book is not VAT-registered — vat_total/vat_rate/vat_treatment must be empty.' },
        { status: 400 },
      );
    }
  }

  // Double-entry sanity: sum of debits == sum of credits.
  const totalDr = body.splits.reduce((s, x) => s + x.debit, 0);
  const totalCr = body.splits.reduce((s, x) => s + x.credit, 0);
  if (Math.abs(totalDr - totalCr) > 0.005) {
    return NextResponse.json(
      { error: `Out of balance: Dr ${totalDr.toFixed(2)} vs Cr ${totalCr.toFixed(2)}` },
      { status: 400 },
    );
  }

  // Block posting to any inactive account. Existing entries can still be
  // edited (the PATCH route allows accounts that were already used) — this
  // create endpoint is strictly "new entries", so a locked account is off
  // limits, mirroring what AccountPicker hides client-side.
  {
    const accountIds = [
      ...body.splits.map(s => s.account_id),
      ...(body.primary_account_id ? [body.primary_account_id] : []),
    ];
    if (accountIds.length > 0) {
      const { data: locked } = await supabase
        .from('bookkeeping_accounts')
        .select('id, name')
        .in('id', accountIds)
        .eq('inactive', true);
      if (locked && locked.length > 0) {
        return NextResponse.json(
          { error: `Can’t post to locked account: ${locked.map(l => l.name).join(', ')}. Unlock it in Properties first, or pick a different account.` },
          { status: 400 },
        );
      }
    }
  }

  // Fund validation: any fund_id supplied on a split must belong to THIS book.
  {
    const fundIds = [...new Set(body.splits.map(s => s.fund_id).filter((f): f is string => !!f))];
    if (fundIds.length > 0) {
      const { data: bookFunds } = await supabase
        .from('bookkeeping_funds').select('id').eq('book_id', params.id).in('id', fundIds);
      const valid = new Set((bookFunds ?? []).map(f => f.id));
      const bad = fundIds.filter(f => !valid.has(f));
      if (bad.length > 0) {
        return NextResponse.json({ error: 'One or more funds do not belong to this book.' }, { status: 400 });
      }
    }
  }

  // Allocate next ref atomically via SQL function.
  const { data: nextSeqData, error: seqErr } = await supabase
    .rpc('bookkeeping_next_ref', { p_book_id: params.id, p_type: body.type });
  if (seqErr || typeof nextSeqData !== 'number') {
    return NextResponse.json({ error: seqErr?.message ?? 'Could not allocate ref' }, { status: 500 });
  }
  const refSeq = nextSeqData;
  const refNo = `${body.type} ${String(refSeq).padStart(6, '0')}`;

  // Insert transaction header.
  const { data: txn, error: txnErr } = await supabase
    .from('bookkeeping_transactions')
    .insert({
      book_id: params.id,
      type: body.type,
      ref_no: refNo,
      ref_seq: refSeq,
      date: body.date,
      payee_text: body.payee_text ?? null,
      details: body.details ?? null,
      total: body.total,
      vat_total: body.vat_total,
      vat_rate: body.vat_rate ?? null,
      vat_treatment: body.vat_treatment ?? null,
      vat_period_override: vatPeriodOverride,
      primary_account_id: body.primary_account_id ?? null,
      frs_capital_reclaim: body.frs_capital_reclaim ?? false,
      status: 'posted',
      created_by: ctx.userId,
      posted_at: new Date().toISOString(),
    })
    .select('id')
    .single();
  if (txnErr || !txn) {
    return NextResponse.json({ error: txnErr?.message ?? 'Insert failed' }, { status: 500 });
  }

  // Insert splits.
  const splitRows = body.splits.map((s, i) => ({
    transaction_id: txn.id,
    line_no: i + 1,
    account_id: s.account_id,
    debit: s.debit,
    credit: s.credit,
    entry_details: s.entry_details ?? null,
    notes: s.notes ?? null,
    fund_id: s.fund_id ?? null,
  }));
  const { data: insertedSplits, error: splitsErr } = await supabase
    .from('bookkeeping_transaction_splits')
    .insert(splitRows)
    .select('id, line_no');
  if (splitsErr) {
    // Rollback the header — splits failed, the transaction is inconsistent.
    await supabase.from('bookkeeping_transactions').delete().eq('id', txn.id);
    return NextResponse.json({ error: splitsErr.message }, { status: 500 });
  }

  // Audit
  await supabase.from('bookkeeping_audit').insert({
    book_id: params.id,
    user_id: ctx.userId,
    entity_type: 'transaction',
    entity_id: txn.id,
    action: 'create',
    diff: { type: body.type, ref_no: refNo, total: body.total, splits: body.splits.length },
  });

  // ── Reversing journal: also post the auto-reversal entry ────────────────
  // Allocates its own ref (so the pair shows distinctly in lists), flips Dr/Cr
  // on every split, and links back to the original via reverses_transaction_id.
  if (body.type === 'RJN' && body.reverses_on_date) {
    const { data: revSeqData, error: revSeqErr } = await supabase
      .rpc('bookkeeping_next_ref', { p_book_id: params.id, p_type: 'RJN' });
    if (revSeqErr || typeof revSeqData !== 'number') {
      console.error('[bookkeeping] RJN reversal ref allocation failed', revSeqErr);
    } else {
      const revSeq = revSeqData;
      const revRefNo = `RJN ${String(revSeq).padStart(6, '0')}`;
      const { data: revTxn, error: revTxnErr } = await supabase
        .from('bookkeeping_transactions')
        .insert({
          book_id: params.id,
          type: 'RJN',
          ref_no: revRefNo,
          ref_seq: revSeq,
          date: body.reverses_on_date,
          payee_text: body.payee_text ?? null,
          details: body.details ? `Reversal of ${refNo}: ${body.details}` : `Reversal of ${refNo}`,
          total: body.total,
          vat_total: 0,
          vat_rate: null,
          vat_treatment: null,
          primary_account_id: null,
          status: 'posted',
          created_by: ctx.userId,
          posted_at: new Date().toISOString(),
          reverses_transaction_id: txn.id,
        })
        .select('id')
        .single();
      if (revTxnErr || !revTxn) {
        console.error('[bookkeeping] RJN reversal header insert failed', revTxnErr);
      } else {
        // Flip Dr/Cr on every line of the original.
        const reversedRows = body.splits.map((s, i) => ({
          transaction_id: revTxn.id,
          line_no: i + 1,
          account_id: s.account_id,
          debit: s.credit,
          credit: s.debit,
          entry_details: s.entry_details ?? null,
          notes: s.notes ?? null,
          fund_id: s.fund_id ?? null,
        }));
        const { data: revInserted, error: revSplitsErr } = await supabase
          .from('bookkeeping_transaction_splits')
          .insert(reversedRows)
          .select('id, line_no');
        if (revSplitsErr) {
          // Roll back JUST the reversal header — the original journal stays
          await supabase.from('bookkeeping_transactions').delete().eq('id', revTxn.id);
          console.error('[bookkeeping] RJN reversal splits insert failed', revSplitsErr);
        } else {
          await supabase.from('bookkeeping_audit').insert({
            book_id: params.id,
            user_id: ctx.userId,
            entity_type: 'transaction',
            entity_id: revTxn.id,
            action: 'create',
            diff: { type: 'RJN', ref_no: revRefNo, reverses: refNo, total: body.total },
          });

          // ── Auto-match the pair ─────────────────────────────────────────
          // Each original line and its reversal counterpart sit on the same
          // account, equal-and-opposite, so they net to zero there. Match them
          // per line (one match per account touched) so the ledger shows the
          // accrual/prepayment and its reversal as cleared rather than two open
          // items. Best-effort — a failure here never fails the post.
          const origIdByLine = new Map<number, string>(
            (insertedSplits ?? []).map(s => [s.line_no as number, s.id as string]),
          );
          for (const rev of revInserted ?? []) {
            const origId = origIdByLine.get(rev.line_no as number);
            if (!origId) continue;
            const { data: matchHeader, error: matchErr } = await supabase
              .from('bookkeeping_matches')
              .insert({
                book_id: params.id,
                status: 'full',
                notes: `Auto-matched reversing journal (${refNo} ↔ ${revRefNo})`,
                created_by: ctx.userId,
              })
              .select('id')
              .single();
            if (matchErr || !matchHeader) {
              console.error('[bookkeeping] RJN auto-match header failed', matchErr);
              continue;
            }
            const { error: matchLinesErr } = await supabase
              .from('bookkeeping_match_lines')
              .insert([
                { match_id: matchHeader.id, split_id: origId },
                { match_id: matchHeader.id, split_id: rev.id as string },
              ]);
            if (matchLinesErr) {
              console.error('[bookkeeping] RJN auto-match lines failed', matchLinesErr);
              await supabase.from('bookkeeping_matches').delete().eq('id', matchHeader.id);
            }
          }
        }
      }
    }
  }

  // ── Payee memorisation ──────────────────────────────────────────────────
  // When the user typed a payee/details on a single-analysis-line transaction
  // (PAY/CHQ/REC/SIN/SCR/PIN/PCR), store the template so the same payee next
  // time auto-fills the analysis account and VAT treatment. Multi-line and
  // JRN transactions aren't memorised (they don't fit the per-payee model).
  const payeeText = (body.payee_text ?? '').trim();
  const hasSingleAnalysis = body.splits.length <= 3; // primary + analysis (+ optional VAT)
  if (payeeText && hasSingleAnalysis && body.primary_account_id) {
    try {
      // Pick the "analysis" split — the line that isn't the primary account
      // and isn't a VAT routing line. Heuristic: first non-primary line that
      // has the largest absolute value.
      const analysisSplit = body.splits
        .filter(s => s.account_id !== body.primary_account_id)
        .sort((a, b) => Math.abs(b.debit + b.credit) - Math.abs(a.debit + a.credit))[0];
      const payeeKey = payeeText.toLowerCase();
      const template = {
        analysis_account_id: analysisSplit?.account_id ?? null,
        vat_treatment: body.vat_treatment ?? null,
        vat_rate: body.vat_rate ?? null,
        entry_details: analysisSplit?.entry_details ?? null,
      };

      // Upsert via select-then-update/insert (Supabase JS doesn't expose the
      // ON CONFLICT shortcut we'd want for atomic upsert here).
      const { data: existing } = await supabase
        .from('bookkeeping_payee_memory')
        .select('id, use_count')
        .eq('book_id', params.id)
        .eq('transaction_type', body.type)
        .eq('payee_key', payeeKey)
        .maybeSingle();

      if (existing) {
        await supabase.from('bookkeeping_payee_memory').update({
          payee_display: payeeText,
          last_used_at: new Date().toISOString(),
          use_count: (existing.use_count ?? 1) + 1,
          template,
          updated_at: new Date().toISOString(),
        }).eq('id', existing.id);
      } else {
        await supabase.from('bookkeeping_payee_memory').insert({
          book_id: params.id,
          transaction_type: body.type,
          payee_key: payeeKey,
          payee_display: payeeText,
          template,
        });
      }
    } catch (e) {
      // Best-effort — memorisation failure shouldn't fail the post.
      console.error('[bookkeeping] payee memorisation failed', e);
    }
  }

  // Re-fetch with joined refs for the response.
  const { data: full, error: refetchErr } = await supabase
    .from('bookkeeping_transactions')
    .select(TX_SELECT)
    .eq('id', txn.id)
    .single();
  if (refetchErr) {
    return NextResponse.json({ error: refetchErr.message }, { status: 500 });
  }

  return NextResponse.json({ transaction: full });
}
