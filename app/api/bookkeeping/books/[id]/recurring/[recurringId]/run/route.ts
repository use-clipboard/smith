import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { getBookkeepingContext } from '@/lib/bookkeeping/server';
import { advanceDate } from '@/lib/bookkeeping/recurring';
import type { RecurringTemplate, RecurringFrequency } from '@/types/bookkeeping';

// ── POST /api/bookkeeping/books/[id]/recurring/[recurringId]/run ─────────────
// Post ONE due occurrence: materialise the template into a real transaction
// dated on the due date, then advance next_due_date by one interval. If still
// behind (multiple missed periods) the user posts again. Manual + idempotent
// per click; never auto-catches-up unreviewed.
export async function POST(_req: NextRequest, { params }: { params: { id: string; recurringId: string } }) {
  const ctx = await getBookkeepingContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const supabase = createClient();

  // Recurring row + its book (firm gate + locks).
  const { data: rec } = await supabase
    .from('bookkeeping_recurring_transactions')
    .select('*, book:bookkeeping_books!inner(id, firm_id, admin_locked, period_lock_date)')
    .eq('id', params.recurringId).eq('book_id', params.id)
    .maybeSingle();
  if (!rec) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const book = (rec as unknown as { book?: { firm_id?: string; admin_locked?: boolean; period_lock_date?: string | null } }).book;
  if (book?.firm_id !== ctx.firmId) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  if (!rec.active) return NextResponse.json({ error: 'This recurring transaction is paused.' }, { status: 400 });

  const dueDate = rec.next_due_date as string;
  if (rec.end_date && dueDate > (rec.end_date as string)) {
    return NextResponse.json({ error: 'This recurring transaction has ended.' }, { status: 400 });
  }
  const maxOccurrences = (rec.max_occurrences as number | null) ?? null;
  const occurrencesPosted = (rec.occurrences_posted as number | null) ?? 0;
  if (maxOccurrences != null && occurrencesPosted >= maxOccurrences) {
    return NextResponse.json({ error: 'This recurring transaction has reached its occurrence limit.' }, { status: 400 });
  }

  const isAdmin = ctx.userRole === 'admin';
  if (book.admin_locked && !isAdmin) return NextResponse.json({ error: 'Book is admin-locked' }, { status: 403 });
  if (book.period_lock_date && dueDate <= book.period_lock_date && !isAdmin) {
    return NextResponse.json(
      { error: `Due date ${dueDate} is on or before the period lock (${book.period_lock_date}). Edit the schedule or unlock the period.` },
      { status: 403 },
    );
  }

  const tpl = rec.template as RecurringTemplate;
  if (!tpl?.splits?.length) return NextResponse.json({ error: 'Template has no splits.' }, { status: 400 });

  // Defensive balance check.
  const dr = tpl.splits.reduce((s, x) => s + (x.debit || 0), 0);
  const cr = tpl.splits.reduce((s, x) => s + (x.credit || 0), 0);
  if (Math.abs(dr - cr) > 0.005) {
    return NextResponse.json({ error: `Template is out of balance: Dr ${dr.toFixed(2)} vs Cr ${cr.toFixed(2)}` }, { status: 400 });
  }

  const type = rec.type as string;
  const { data: seq, error: seqErr } = await supabase.rpc('bookkeeping_next_ref', { p_book_id: params.id, p_type: type });
  if (seqErr || typeof seq !== 'number') {
    return NextResponse.json({ error: seqErr?.message ?? 'Could not allocate ref' }, { status: 500 });
  }
  const refNo = `${type} ${String(seq).padStart(6, '0')}`;

  const { data: txn, error: txnErr } = await supabase
    .from('bookkeeping_transactions')
    .insert({
      book_id: params.id,
      type,
      ref_no: refNo,
      ref_seq: seq,
      date: dueDate,
      payee_text: tpl.payee_text ?? null,
      details: tpl.details ?? null,
      total: tpl.total ?? 0,
      vat_total: tpl.vat_total ?? 0,
      vat_rate: tpl.vat_rate ?? null,
      vat_treatment: tpl.vat_treatment ?? null,
      primary_account_id: tpl.primary_account_id ?? null,
      status: 'posted',
      created_by: ctx.userId,
      posted_at: new Date().toISOString(),
    })
    .select('id')
    .single();
  if (txnErr || !txn) return NextResponse.json({ error: txnErr?.message ?? 'Insert failed' }, { status: 500 });

  const { error: splitsErr } = await supabase
    .from('bookkeeping_transaction_splits')
    .insert(tpl.splits.map((s, i) => ({
      transaction_id: txn.id,
      line_no: i + 1,
      account_id: s.account_id,
      debit: s.debit || 0,
      credit: s.credit || 0,
      entry_details: s.entry_details ?? null,
      notes: s.notes ?? null,
      fund_id: s.fund_id ?? null,
    })));
  if (splitsErr) {
    await supabase.from('bookkeeping_transactions').delete().eq('id', txn.id);
    return NextResponse.json({ error: splitsErr.message }, { status: 500 });
  }

  // Advance the schedule by one interval and bump the occurrence counter.
  // When a count limit is set and now reached, deactivate the schedule so it
  // stops surfacing as due.
  const nextDue = advanceDate(dueDate, rec.frequency as RecurringFrequency, rec.interval_count as number);
  const newPosted = occurrencesPosted + 1;
  const reachedLimit = maxOccurrences != null && newPosted >= maxOccurrences;
  await supabase
    .from('bookkeeping_recurring_transactions')
    .update({
      next_due_date: nextDue,
      last_run_date: dueDate,
      occurrences_posted: newPosted,
      ...(reachedLimit ? { active: false } : {}),
      updated_at: new Date().toISOString(),
    })
    .eq('id', params.recurringId);

  await supabase.from('bookkeeping_audit').insert({
    book_id: params.id,
    user_id: ctx.userId,
    entity_type: 'transaction',
    entity_id: txn.id,
    action: 'create',
    diff: { kind: 'recurring', recurring_id: params.recurringId, ref_no: refNo, date: dueDate, total: tpl.total },
  });

  return NextResponse.json({ posted: true, transaction_id: txn.id, ref_no: refNo, next_due_date: nextDue });
}
