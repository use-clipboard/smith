import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase-server';
import { getBookkeepingContext } from '@/lib/bookkeeping/server';

const VAT_TREATMENTS = ['no_vat','standard_20','reduced_5','zero','exempt','outside_scope'] as const;

const SplitSchema = z.object({
  account_id: z.string().uuid(),
  debit: z.number().min(0).default(0),
  credit: z.number().min(0).default(0),
  entry_details: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  fund_id: z.string().uuid().nullable().optional(),
}).refine(s => s.debit === 0 || s.credit === 0, {
  message: 'A split cannot be both a debit and a credit',
});

const PatchBody = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  payee_text: z.string().max(200).nullable().optional(),
  details: z.string().max(500).nullable().optional(),
  total: z.number().min(0).optional(),
  vat_total: z.number().min(0).optional(),
  vat_rate: z.number().min(0).max(100).nullable().optional(),
  vat_treatment: z.enum(VAT_TREATMENTS).nullable().optional(),
  primary_account_id: z.string().uuid().nullable().optional(),
  splits: z.array(SplitSchema).min(1).optional(),
  /** Late-entry flag — same semantics as POST. The user has acknowledged the
   *  edited date lands in a filed VAT period and wants the VAT carried into
   *  the next return. */
  late_entry: z.boolean().optional(),
  /** Flat Rate Scheme — purchase is a reclaimable capital asset. */
  frs_capital_reclaim: z.boolean().optional(),
  /** Link to the source document (Google Drive via Capture/Vault). Pass null to clear. */
  source_doc_url: z.string().url().max(2000).nullable().optional(),
  source_doc_name: z.string().max(300).nullable().optional(),
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
  primary_account_id, frs_capital_reclaim, status, source_doc_url, source_doc_name, created_by, created_at, updated_at, posted_at,
  primary_account:bookkeeping_accounts!bookkeeping_transactions_primary_account_id_fkey(id, name, ledger, account_type),
  splits:bookkeeping_transaction_splits(
    id, transaction_id, line_no, account_id, debit, credit, entry_details, notes, fund_id,
    account:bookkeeping_accounts(id, name, ledger, account_type),
    fund:bookkeeping_funds(id, name, fund_type)
  )
`;

// ── GET single transaction ───────────────────────────────────────────────────
export async function GET(_req: NextRequest, { params }: { params: { id: string; txId: string } }) {
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
    .from('bookkeeping_transactions')
    .select(TX_SELECT)
    .eq('id', params.txId)
    .eq('book_id', params.id)
    .single();
  if (error || !data) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  return NextResponse.json({ transaction: data });
}

// ── PATCH ─────────────────────────────────────────────────────────────────────
// Header fields can be edited; splits are replaced wholesale when provided
// (simpler than diffing — splits are small per transaction).
// Does NOT change ref_no — once allocated, refs are immutable (audit trail).
export async function PATCH(req: NextRequest, { params }: { params: { id: string; txId: string } }) {
  const ctx = await getBookkeepingContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  let body: z.infer<typeof PatchBody>;
  try { body = PatchBody.parse(await req.json()); }
  catch (e) { return NextResponse.json({ error: 'Invalid payload', detail: String(e) }, { status: 400 }); }

  const supabase = createClient();
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

  const { data: existing, error: exErr } = await supabase
    .from('bookkeeping_transactions')
    .select('id, date, vat_total, vat_period_override')
    .eq('id', params.txId)
    .eq('book_id', params.id)
    .single();
  if (exErr || !existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // ── Reconciled bank-line protection ──────────────────────────────────────
  // We protect only the reconciled BANK LINE itself, not the whole
  // transaction. The user can freely edit the other side of a journal, the
  // narrative, and any non-bank accounts/amounts. An edit is blocked only when
  // it would ALTER a reconciled line — change its account or amount, drop it,
  // or move the transaction's date — because that silently breaks a completed
  // reconciliation. A line is "reconciled" when it's ticked off in a
  // reconciled rec (cleared_in_rec_id) or matched to a bank statement line.
  const { data: existingSplitRows, error: existingSplitsErr } = await supabase
    .from('bookkeeping_transaction_splits')
    .select(`
      id, account_id, debit, credit, line_no, cleared_in_rec_id,
      rec:bookkeeping_bank_imports!bookkeeping_transaction_splits_cleared_in_rec_id_fkey(status),
      bank_line:bookkeeping_bank_lines!bookkeeping_bank_lines_matched_split_id_fkey(id)
    `)
    .eq('transaction_id', params.txId);
  // Fail closed: if we can't read the reconciliation status we must NOT proceed
  // as if the transaction were unlocked — that could wholesale-replace a
  // reconciled bank line and silently break the rec.
  if (existingSplitsErr) {
    return NextResponse.json({ error: existingSplitsErr.message }, { status: 500 });
  }

  type ExistingSplit = {
    id: string; account_id: string; debit: number; credit: number; line_no: number | null;
    cleared_in_rec_id: string | null;
    rec: { status: string } | { status: string }[] | null;
    bank_line: { id: string } | { id: string }[] | null;
  };
  const existingSplits = (existingSplitRows ?? []) as ExistingSplit[];
  const splitIsReconciled = (s: ExistingSplit): boolean => {
    const rec = Array.isArray(s.rec) ? s.rec[0] : s.rec;
    const clearedInReconciledRec = !!s.cleared_in_rec_id && rec?.status === 'reconciled';
    const bl = s.bank_line;
    const matchedToBankLine = Array.isArray(bl) ? bl.length > 0 : !!bl;
    return clearedInReconciledRec || matchedToBankLine;
  };
  const lockedSplits = existingSplits.filter(splitIsReconciled);
  const amountsEqual = (a: number, b: number) => Math.abs(a - b) < 0.005;

  const RECONCILED_BLOCK_MESSAGE =
    'This change isn’t possible — the entry is already reconciled in the bank. Reopen the reconciliation (Bank Rec → History) to change the reconciled line, or leave that line unchanged and edit the rest.';

  if (lockedSplits.length > 0) {
    // Moving the date would move the reconciled bank line.
    if (body.date && body.date !== existing.date) {
      return NextResponse.json({ error: 'bank_reconciled', message: RECONCILED_BLOCK_MESSAGE }, { status: 409 });
    }
    // If splits are being replaced, every reconciled line must survive intact
    // (same account + same debit + same credit).
    if (body.splits) {
      const pool = body.splits.map(s => ({ s, used: false }));
      for (const ls of lockedSplits) {
        const hit = pool.find(p => !p.used
          && p.s.account_id === ls.account_id
          && amountsEqual(p.s.debit, Number(ls.debit))
          && amountsEqual(p.s.credit, Number(ls.credit)));
        if (!hit) {
          return NextResponse.json({ error: 'bank_reconciled', message: RECONCILED_BLOCK_MESSAGE }, { status: 409 });
        }
        hit.used = true;
      }
    }
  }

  // Period lock blocks edits to/from a locked date.
  if (book.period_lock_date && !isAdmin) {
    const oldDate = existing.date;
    const newDate = body.date ?? oldDate;
    if (oldDate <= book.period_lock_date || newDate <= book.period_lock_date) {
      return NextResponse.json(
        { error: `Period locked through ${book.period_lock_date}` },
        { status: 403 },
      );
    }
  }

  // ── VAT late-entry handling on edit ──────────────────────────────────────
  // If the new (or unchanged) date is in a filed VAT period AND the
  // transaction carries VAT, we treat it the same as a new post: require the
  // user to acknowledge the late-entry flag. Otherwise we clear the override.
  const newDate = body.date ?? existing.date;
  const newVatTotal = body.vat_total ?? Number(existing.vat_total ?? 0);
  const carriesVat = newVatTotal > 0;
  let vatPeriodOverride: string | null | undefined = undefined; // undefined = don't change
  if (book.vat_registered && book.vat_lock_date) {
    if (newDate <= book.vat_lock_date && carriesVat) {
      if (!body.late_entry) {
        return NextResponse.json(
          {
            error: 'late_entry_required',
            message: `${newDate} falls in a filed VAT period (locked through ${book.vat_lock_date}). Tick "Include in next VAT return" to save as a late entry.`,
            vat_lock_date: book.vat_lock_date,
          },
          { status: 409 },
        );
      }
      vatPeriodOverride = addOneDay(book.vat_lock_date);
    } else {
      // Date is no longer in the locked period → clear any prior override.
      vatPeriodOverride = null;
    }
  }

  // Validate split balance if splits are being replaced.
  if (body.splits) {
    const totalDr = body.splits.reduce((s, x) => s + x.debit, 0);
    const totalCr = body.splits.reduce((s, x) => s + x.credit, 0);
    if (Math.abs(totalDr - totalCr) > 0.005) {
      return NextResponse.json(
        { error: `Out of balance: Dr ${totalDr.toFixed(2)} vs Cr ${totalCr.toFixed(2)}` },
        { status: 400 },
      );
    }
  }

  // Block introducing a NEW reference to a locked account on edit. Accounts
  // already used by this transaction can stay (so the user can fix a typo,
  // re-date, etc. without first unlocking the account) — but a fresh
  // account_id that points at an inactive row gets rejected.
  if (body.splits || body.primary_account_id !== undefined) {
    const { data: previousSplits } = await supabase
      .from('bookkeeping_transaction_splits')
      .select('account_id')
      .eq('transaction_id', params.txId);
    const previouslyUsed = new Set<string>(
      (previousSplits ?? []).map(r => r.account_id as string),
    );
    const requestedIds = new Set<string>([
      ...((body.splits ?? []).map(s => s.account_id)),
      ...(body.primary_account_id ? [body.primary_account_id] : []),
    ]);
    const candidatesToCheck = [...requestedIds].filter(id => !previouslyUsed.has(id));
    if (candidatesToCheck.length > 0) {
      const { data: locked } = await supabase
        .from('bookkeeping_accounts')
        .select('id, name')
        .in('id', candidatesToCheck)
        .eq('inactive', true);
      if (locked && locked.length > 0) {
        return NextResponse.json(
          { error: `Can’t post to locked account: ${locked.map(l => l.name).join(', ')}. Unlock it in Properties first, or pick a different account.` },
          { status: 400 },
        );
      }
    }
  }

  // Header patch
  const patch: Record<string, unknown> = {};
  if (body.date !== undefined)               patch.date = body.date;
  if (body.payee_text !== undefined)         patch.payee_text = body.payee_text;
  if (body.details !== undefined)            patch.details = body.details;
  if (body.total !== undefined)              patch.total = body.total;
  if (body.vat_total !== undefined)          patch.vat_total = body.vat_total;
  if (body.vat_rate !== undefined)           patch.vat_rate = body.vat_rate;
  if (body.vat_treatment !== undefined)      patch.vat_treatment = body.vat_treatment;
  if (body.primary_account_id !== undefined) patch.primary_account_id = body.primary_account_id;
  if (body.frs_capital_reclaim !== undefined) patch.frs_capital_reclaim = body.frs_capital_reclaim;
  if (body.source_doc_url !== undefined)     patch.source_doc_url = body.source_doc_url;
  if (body.source_doc_name !== undefined)    patch.source_doc_name = body.source_doc_name;
  if (vatPeriodOverride !== undefined)       patch.vat_period_override = vatPeriodOverride;
  patch.updated_at = new Date().toISOString();

  const { error: updErr } = await supabase
    .from('bookkeeping_transactions')
    .update(patch)
    .eq('id', params.txId);
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });

  // Write splits if provided. When the transaction has reconciled bank lines we
  // KEEP those exact rows in place (preserving their cleared_in_rec_id and the
  // bank_lines link) and only replace the rest, so the reconciliation stays
  // intact. Otherwise we replace wholesale. Validation above already guaranteed
  // every reconciled line is preserved unchanged.
  if (body.splits) {
    if (lockedSplits.length > 0) {
      const lockedPool = lockedSplits.map(l => ({ l, used: false }));
      // Insert line numbers continue above the current max so they can never
      // collide with a preserved row's line_no.
      let nextLine = existingSplits.reduce((m, s) => Math.max(m, s.line_no ?? 0), 0);
      const toInsert: Record<string, unknown>[] = [];
      for (const s of body.splits) {
        const match = lockedPool.find(p => !p.used
          && p.l.account_id === s.account_id
          && amountsEqual(Number(p.l.debit), s.debit)
          && amountsEqual(Number(p.l.credit), s.credit));
        if (match) {
          match.used = true; // preserved in place — nothing to write
        } else {
          nextLine += 1;
          toInsert.push({
            transaction_id: params.txId,
            line_no: nextLine,
            account_id: s.account_id,
            debit: s.debit,
            credit: s.credit,
            entry_details: s.entry_details ?? null,
            notes: s.notes ?? null,
            fund_id: s.fund_id ?? null,
          });
        }
      }
      // Delete only the non-reconciled existing splits.
      const lockedIds = new Set(lockedSplits.map(l => l.id));
      const removeIds = existingSplits.filter(s => !lockedIds.has(s.id)).map(s => s.id);
      if (removeIds.length > 0) {
        const { error: delErr } = await supabase
          .from('bookkeeping_transaction_splits')
          .delete()
          .in('id', removeIds);
        if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 });
      }
      if (toInsert.length > 0) {
        const { error: insErr } = await supabase
          .from('bookkeeping_transaction_splits')
          .insert(toInsert);
        if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });
      }
    } else {
      const { error: delErr } = await supabase
        .from('bookkeeping_transaction_splits')
        .delete()
        .eq('transaction_id', params.txId);
      if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 });

      const newRows = body.splits.map((s, i) => ({
        transaction_id: params.txId,
        line_no: i + 1,
        account_id: s.account_id,
        debit: s.debit,
        credit: s.credit,
        entry_details: s.entry_details ?? null,
        notes: s.notes ?? null,
        fund_id: s.fund_id ?? null,
      }));
      const { error: insErr } = await supabase
        .from('bookkeeping_transaction_splits')
        .insert(newRows);
      if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });
    }
  }

  // Audit
  await supabase.from('bookkeeping_audit').insert({
    book_id: params.id,
    user_id: ctx.userId,
    entity_type: 'transaction',
    entity_id: params.txId,
    action: 'update',
    diff: body,
  });

  const { data: full, error: refetchErr } = await supabase
    .from('bookkeeping_transactions')
    .select(TX_SELECT)
    .eq('id', params.txId)
    .single();
  if (refetchErr) return NextResponse.json({ error: refetchErr.message }, { status: 500 });

  return NextResponse.json({ transaction: full });
}

// ── DELETE ───────────────────────────────────────────────────────────────────
// Hard delete (cascades to splits). ref_seq is NEVER decremented — the gap
// in the sequence is the audit trail.
export async function DELETE(_req: NextRequest, { params }: { params: { id: string; txId: string } }) {
  const ctx = await getBookkeepingContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

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

  const { data: existing, error: exErr } = await supabase
    .from('bookkeeping_transactions')
    .select('id, date, type, ref_no')
    .eq('id', params.txId)
    .eq('book_id', params.id)
    .single();
  if (exErr || !existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  if (book.period_lock_date && existing.date <= book.period_lock_date && !isAdmin) {
    return NextResponse.json(
      { error: `Period locked through ${book.period_lock_date}` },
      { status: 403 },
    );
  }

  // Bank-rec lock — same rule as PATCH: can't delete a transaction whose
  // splits are reconciled. User must un-reconcile from the Bank Rec tab first.
  const { data: reconciledLink } = await supabase
    .from('bookkeeping_bank_lines')
    .select(`id, matched_split_id, split:bookkeeping_transaction_splits!bookkeeping_bank_lines_matched_split_id_fkey(transaction_id)`)
    .not('matched_split_id', 'is', null)
    .eq('split.transaction_id', params.txId)
    .limit(1)
    .maybeSingle();
  if (reconciledLink && reconciledLink.matched_split_id) {
    return NextResponse.json({
      error: 'bank_reconciled',
      message: 'This transaction is reconciled against a bank statement line. Un-reconcile it on the Bank Rec tab before deleting.',
    }, { status: 409 });
  }

  // Period-first bank-rec lock — same guard as PATCH.
  const { data: clearedInClosedRec } = await supabase
    .from('bookkeeping_transaction_splits')
    .select(`id, cleared_in_rec_id, rec:bookkeeping_bank_imports!bookkeeping_transaction_splits_cleared_in_rec_id_fkey(id, status, display_label, file_name)`)
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
      message: `This transaction is cleared inside a completed reconciliation (${blockingRec.rec.display_label ?? blockingRec.rec.file_name ?? 'rec'}). Reopen the rec from the History tab before deleting.`,
      // @ts-expect-error — embed type isn't perfectly inferred
      rec_id: blockingRec.rec.id,
    }, { status: 409 });
  }

  const { error: delErr } = await supabase
    .from('bookkeeping_transactions')
    .delete()
    .eq('id', params.txId);
  if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 });

  await supabase.from('bookkeeping_audit').insert({
    book_id: params.id,
    user_id: ctx.userId,
    entity_type: 'transaction',
    entity_id: params.txId,
    action: 'delete',
    diff: { type: existing.type, ref_no: existing.ref_no, date: existing.date },
  });

  return NextResponse.json({ ok: true });
}
