import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase-server';
import { getBookkeepingContext } from '@/lib/bookkeeping/server';

// ── POST /api/bookkeeping/books/[id]/auto-match ─────────────────────────────
//
// One-click "balance + match" workflow used by the WOF / CTX buttons in the
// Account ledger view. Given a set of selected splits on a single account:
//
//   1. Compute the net Dr - Cr across the selection.
//   2. Find (or create) the contra account:
//        WOF → "Expenses: Write offs/discounts"
//        CTX → "Bank: Petty cash"   (created with system_managed=true so
//              it's protected from manual posting)
//   3. Post a new transaction with two legs:
//        • A leg on the SAME account as the selection, equal-and-opposite
//          to the net so the selection now balances to zero.
//        • A contra leg on the write-off / petty-cash account.
//   4. Match the selected splits + the new same-account leg as one
//      allocation (status='full'), so all of them disappear from the
//      "Open entries" view together.
//
// Transaction types:
//   WOF → type='WOF'
//   CTX → 'PAY' or 'REC', depending on which way Petty cash moves
//         (Dr Petty cash = money in → REC; Cr Petty cash = money out → PAY).
//   We deliberately use PAY/REC for CTX rather than introducing a CTX type:
//   VT's CTX is "cash transaction" but the accounting shape is identical
//   to a PAY/REC against a Petty cash bank account — keeping the type
//   space small reduces UI complexity elsewhere.

const Body = z.object({
  split_ids: z.array(z.string().uuid()).min(1),
  action: z.enum(['wof', 'ctx']),
  /** Optional posting date. Defaults to today. */
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  /** Free-text caption for the new transaction. Defaults to a generated one. */
  details: z.string().max(500).optional(),
});

interface SelectedSplit {
  id: string;
  transaction_id: string;
  account_id: string;
  debit: number;
  credit: number;
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getBookkeepingContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  let body: z.infer<typeof Body>;
  try { body = Body.parse(await req.json()); }
  catch (e) { return NextResponse.json({ error: 'Invalid payload', detail: String(e) }, { status: 400 }); }

  const supabase = createClient();

  // ── 1. Book gate ─────────────────────────────────────────────────────────
  const { data: book, error: bookErr } = await supabase
    .from('bookkeeping_books')
    .select('id, admin_locked')
    .eq('id', params.id)
    .eq('firm_id', ctx.firmId)
    .single();
  if (bookErr || !book) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (book.admin_locked && ctx.userRole !== 'admin') {
    return NextResponse.json({ error: 'Book is admin-locked' }, { status: 403 });
  }

  // ── 2. Load + validate the selected splits ───────────────────────────────
  const { data: splitsRaw, error: splitsErr } = await supabase
    .from('bookkeeping_transaction_splits')
    .select('id, transaction_id, account_id, debit, credit, transaction:bookkeeping_transactions!inner(book_id, date)')
    .in('id', body.split_ids);
  if (splitsErr) return NextResponse.json({ error: splitsErr.message }, { status: 500 });
  if (!splitsRaw || splitsRaw.length !== body.split_ids.length) {
    return NextResponse.json({ error: 'One or more splits not found' }, { status: 400 });
  }
  // All splits must belong to this book — defence against id-poaching across firms.
  type SelectedSplitWithTxn = SelectedSplit & { transaction: { book_id: string; date: string } };
  for (const s of splitsRaw as unknown as SelectedSplitWithTxn[]) {
    if (s.transaction.book_id !== params.id) {
      return NextResponse.json({ error: 'All splits must belong to this book' }, { status: 400 });
    }
  }
  // Latest transaction date across the selection — used as the date of the
  // new balancing entry. ISO YYYY-MM-DD sorts lexicographically so we can
  // just pick the max. Falls back to today if (somehow) no dates came back.
  const latestSelectedDate = (splitsRaw as unknown as SelectedSplitWithTxn[])
    .map(s => s.transaction.date)
    .filter(Boolean)
    .sort()
    .pop() ?? new Date().toISOString().slice(0, 10);
  // All splits on the SAME account — matching can't cross accounts.
  const accountId = (splitsRaw[0] as unknown as SelectedSplit).account_id;
  if (!(splitsRaw as unknown as SelectedSplit[]).every(s => s.account_id === accountId)) {
    return NextResponse.json({ error: 'All splits must be on the same account' }, { status: 400 });
  }
  // Refuse if any are already matched — would create overlapping allocations.
  const { data: alreadyMatched } = await supabase
    .from('bookkeeping_match_lines')
    .select('split_id')
    .in('split_id', body.split_ids);
  if ((alreadyMatched ?? []).length > 0) {
    return NextResponse.json({ error: 'One or more selected entries are already matched' }, { status: 409 });
  }

  // Net Dr − Cr across the selection. Positive net means the account is
  // net-debit (we'd Cr it to balance); negative means net-credit (we'd Dr).
  const net = +(splitsRaw as unknown as SelectedSplit[]).reduce(
    (s, x) => s + Number(x.debit) - Number(x.credit), 0,
  ).toFixed(2);
  if (Math.abs(net) < 0.005) {
    return NextResponse.json({ error: 'Selected entries already balance — no balancing entry needed' }, { status: 400 });
  }
  const amount = Math.abs(net);

  // ── 3. Find or create the contra account ─────────────────────────────────
  const contraSpec = body.action === 'wof'
    ? { ledger: 'Expenses', name: 'Write offs/discounts', account_type: 'expense' as const, system_managed: false }
    : { ledger: 'Bank',     name: 'Petty cash',            account_type: 'asset'   as const, system_managed: true  };

  const { data: existingContra } = await supabase
    .from('bookkeeping_accounts')
    .select('id')
    .eq('book_id', params.id)
    .eq('ledger', contraSpec.ledger)
    .eq('name', contraSpec.name)
    .maybeSingle();

  let contraAccountId = existingContra?.id as string | undefined;
  if (!contraAccountId) {
    const { data: created, error: createErr } = await supabase
      .from('bookkeeping_accounts')
      .insert({
        book_id: params.id,
        name: contraSpec.name,
        ledger: contraSpec.ledger,
        account_type: contraSpec.account_type,
        system_managed: contraSpec.system_managed,
        sort_order: 9000,
      })
      .select('id')
      .single();
    if (createErr || !created) {
      return NextResponse.json({ error: createErr?.message ?? 'Failed to create contra account' }, { status: 500 });
    }
    contraAccountId = created.id;
  }

  // ── 4. Decide transaction type + leg amounts ─────────────────────────────
  // The "original account" leg has the OPPOSITE side of net so the selection
  // balances to zero once matched. The contra leg has the SAME side.
  //   net > 0 → original leg Cr `amount`, contra leg Dr `amount`
  //   net < 0 → original leg Dr `amount`, contra leg Cr `amount`
  const originalLegIsCr = net > 0;
  const contraLegIsDr   = net > 0;

  // Type:
  //   WOF → 'WOF'
  //   CTX → REC when Dr Petty cash (money in), PAY when Cr Petty cash (money out)
  const txnType: 'WOF' | 'PAY' | 'REC' =
    body.action === 'wof' ? 'WOF'
    : contraLegIsDr ? 'REC' : 'PAY';

  // ── 5. Allocate a ref ────────────────────────────────────────────────────
  const { data: nextSeq, error: seqErr } = await supabase
    .rpc('bookkeeping_next_ref', { p_book_id: params.id, p_type: txnType });
  if (seqErr || typeof nextSeq !== 'number') {
    return NextResponse.json({ error: seqErr?.message ?? 'Could not allocate ref' }, { status: 500 });
  }
  const refNo = `${txnType} ${String(nextSeq).padStart(6, '0')}`;

  // ── 6. Insert the transaction header ─────────────────────────────────────
  // Date the new balancing entry — explicit override > latest selected date.
  // We match the latest selected date (rather than today) so the WOF/CTX
  // sits chronologically alongside the entries it's clearing, instead of
  // skipping forward to whenever the user happened to click the button.
  const today = body.date ?? latestSelectedDate;
  const captionDefault = body.action === 'wof' ? 'Write off' : 'Cash transaction';
  const { data: newTxn, error: txnErr } = await supabase
    .from('bookkeeping_transactions')
    .insert({
      book_id: params.id,
      type: txnType,
      ref_no: refNo,
      ref_seq: nextSeq,
      date: today,
      payee_text: null,
      details: body.details ?? captionDefault,
      total: amount,
      vat_total: 0,
      vat_rate: null,
      vat_treatment: 'no_vat' as const,
      primary_account_id: null,
      status: 'posted' as const,
      created_by: ctx.userId,
      posted_at: new Date().toISOString(),
    })
    .select('id')
    .single();
  if (txnErr || !newTxn) {
    return NextResponse.json({ error: txnErr?.message ?? 'Failed to create transaction' }, { status: 500 });
  }

  // ── 7. Insert the two splits ─────────────────────────────────────────────
  const { data: insertedSplits, error: splitInsErr } = await supabase
    .from('bookkeeping_transaction_splits')
    .insert([
      {
        transaction_id: newTxn.id,
        line_no: 1,
        account_id: accountId,
        debit:  originalLegIsCr ? 0      : amount,
        credit: originalLegIsCr ? amount : 0,
        entry_details: captionDefault,
        notes: null,
      },
      {
        transaction_id: newTxn.id,
        line_no: 2,
        account_id: contraAccountId,
        debit:  contraLegIsDr ? amount : 0,
        credit: contraLegIsDr ? 0      : amount,
        entry_details: captionDefault,
        notes: null,
      },
    ])
    .select('id, account_id');
  if (splitInsErr || !insertedSplits || insertedSplits.length !== 2) {
    // Roll back the header — we don't want orphan transactions on a failure.
    await supabase.from('bookkeeping_transactions').delete().eq('id', newTxn.id);
    return NextResponse.json({ error: splitInsErr?.message ?? 'Failed to create splits' }, { status: 500 });
  }
  // The new same-account leg is the one we'll bundle into the match.
  const newSameAccountSplitId = insertedSplits.find(s => s.account_id === accountId)?.id;
  if (!newSameAccountSplitId) {
    await supabase.from('bookkeeping_transactions').delete().eq('id', newTxn.id);
    return NextResponse.json({ error: 'Could not identify new contra leg for matching' }, { status: 500 });
  }

  // ── 8. Create the match — all selected splits + the new same-account leg ─
  const matchSplitIds = [...body.split_ids, newSameAccountSplitId];
  // bookkeeping_matches has no account_id column — the account is implicit
  // from the splits via bookkeeping_match_lines. Mirror what /matches POST
  // does: just book_id + status + created_by.
  const { data: matchRow, error: matchErr } = await supabase
    .from('bookkeeping_matches')
    .insert({
      book_id: params.id,
      status: 'full' as const,
      created_by: ctx.userId,
    })
    .select('id')
    .single();
  if (matchErr || !matchRow) {
    await supabase.from('bookkeeping_transactions').delete().eq('id', newTxn.id);
    return NextResponse.json({ error: matchErr?.message ?? 'Failed to create match' }, { status: 500 });
  }
  const { error: matchLinesErr } = await supabase
    .from('bookkeeping_match_lines')
    .insert(matchSplitIds.map(sid => ({ match_id: matchRow.id, split_id: sid })));
  if (matchLinesErr) {
    // Tidy up — undo the match + the transaction so the user can retry cleanly.
    await supabase.from('bookkeeping_matches').delete().eq('id', matchRow.id);
    await supabase.from('bookkeeping_transactions').delete().eq('id', newTxn.id);
    return NextResponse.json({ error: matchLinesErr.message }, { status: 500 });
  }

  // ── 9. Audit ─────────────────────────────────────────────────────────────
  await supabase.from('bookkeeping_audit').insert({
    book_id: params.id,
    user_id: ctx.userId,
    entity_type: 'transaction',
    entity_id: newTxn.id,
    action: 'create',
    diff: {
      action: body.action,
      ref_no: refNo,
      amount,
      account_id: accountId,
      contra_account_id: contraAccountId,
      matched_split_count: matchSplitIds.length,
    },
  });

  return NextResponse.json({
    transaction_id: newTxn.id,
    ref_no: refNo,
    amount,
    match_id: matchRow.id,
    matched_split_ids: matchSplitIds,
  });
}
