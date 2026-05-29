import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase-server';
import { getBookkeepingContext } from '@/lib/bookkeeping/server';

// ── POST /api/bookkeeping/books/[id]/years/[yearId]/reopen ───────────────────
// Reverse a year-end close: delete the closing journal (YET), mark the FY
// 'reopened' (retaining audit), and roll the book's period-lock date back to
// the latest still-closed year-end (or clear it). The derived Balance-Sheet
// profit line reappears once the YET is gone.
//
// Admin-only. Refuses if a LATER year is still closed (you must reopen in
// reverse order so the chain of closes stays contiguous).

const Body = z.object({ reason: z.string().trim().max(500).optional() });

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string; yearId: string } },
) {
  const ctx = await getBookkeepingContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  if (ctx.userRole !== 'admin') {
    return NextResponse.json({ error: 'Only an admin can reopen a financial year.' }, { status: 403 });
  }

  let body: z.infer<typeof Body> = {};
  try { body = Body.parse(await req.json().catch(() => ({}))); }
  catch (e) { return NextResponse.json({ error: 'Invalid payload', detail: String(e) }, { status: 400 }); }

  const supabase = createClient();

  const { data: book, error: bookErr } = await supabase
    .from('bookkeeping_books')
    .select('id, firm_id, period_lock_date')
    .eq('id', params.id)
    .eq('firm_id', ctx.firmId)
    .single();
  if (bookErr || !book) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const { data: fy, error: fyErr } = await supabase
    .from('bookkeeping_financial_years')
    .select('id, book_id, start_date, end_date, status, closing_journal_id')
    .eq('id', params.yearId)
    .eq('book_id', params.id)
    .single();
  if (fyErr || !fy) return NextResponse.json({ error: 'Financial year not found' }, { status: 404 });

  if (fy.status !== 'closed') {
    return NextResponse.json({ error: 'This financial year is not closed.' }, { status: 400 });
  }

  // Reopen in reverse order — no later year may still be closed.
  const { data: laterClosed } = await supabase
    .from('bookkeeping_financial_years')
    .select('id')
    .eq('book_id', params.id)
    .eq('status', 'closed')
    .gt('start_date', fy.start_date)
    .limit(1);
  if (laterClosed && laterClosed.length > 0) {
    return NextResponse.json(
      { error: 'A later financial year is still closed. Reopen the most recent closed year first.' },
      { status: 400 },
    );
  }

  // Delete the closing journal (splits cascade via FK / explicit cleanup).
  if (fy.closing_journal_id) {
    await supabase.from('bookkeeping_transaction_splits').delete().eq('transaction_id', fy.closing_journal_id);
    const { error: delErr } = await supabase
      .from('bookkeeping_transactions')
      .delete()
      .eq('id', fy.closing_journal_id)
      .eq('book_id', params.id);
    if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 });
  }

  const { data: updated, error: updErr } = await supabase
    .from('bookkeeping_financial_years')
    .update({
      status: 'reopened',
      closing_journal_id: null,
      reopened_at: new Date().toISOString(),
      reopened_by: ctx.userId,
      reopen_reason: body.reason ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', fy.id)
    .select('id, status')
    .single();
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });

  // Roll the period lock back to the latest remaining closed year-end (or
  // clear it) — but never push it forward.
  const { data: stillClosed } = await supabase
    .from('bookkeeping_financial_years')
    .select('end_date')
    .eq('book_id', params.id)
    .eq('status', 'closed')
    .order('end_date', { ascending: false })
    .limit(1);
  const newLock = stillClosed && stillClosed.length > 0 ? (stillClosed[0].end_date as string) : null;
  if (book.period_lock_date && fy.end_date <= book.period_lock_date) {
    // Only move the lock if it was at/after this year-end (i.e. set by this
    // close). If the team set a later manual lock, leave it alone.
    if ((newLock ?? '') < (book.period_lock_date as string)) {
      await supabase
        .from('bookkeeping_books')
        .update({ period_lock_date: newLock })
        .eq('id', params.id);
    }
  }

  await supabase.from('bookkeeping_audit').insert({
    book_id: params.id,
    user_id: ctx.userId,
    entity_type: 'financial_year',
    entity_id: fy.id,
    action: 'reopen',
    diff: {
      kind: 'year_end_reopen',
      period: { from: fy.start_date, to: fy.end_date },
      deleted_journal: fy.closing_journal_id,
      reason: body.reason ?? null,
    },
  });

  return NextResponse.json({ reopened: true, year: updated });
}
