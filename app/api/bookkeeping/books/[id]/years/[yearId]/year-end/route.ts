import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { getBookkeepingContext } from '@/lib/bookkeeping/server';
import { backfillForwardFys } from '@/lib/bookkeeping/generateFys';

// ── PATCH /api/bookkeeping/books/[id]/years/[yearId]/year-end ────────────────
// Change a client's year-end mid-life (a new Accounting Reference Date). The
// target open financial year is stretched or shortened to end on the new date
// — producing a LONG period (new end later) or SHORT period (new end earlier)
// — and the book's year-end pattern is updated so all FUTURE years follow the
// new date. Closed years are never touched.
//
// Admin-only. Only the latest open year can be changed, and only when no later
// year is closed. Length is unrestricted (warn-but-allow): periods over the
// 18-month Companies House maximum return a non-blocking warning.

/** ISO yyyy-mm-dd → dd/mm/yyyy (UK display). */
function fmtUk(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}

/** Whole months spanned by an inclusive start..end period. */
function monthsBetween(startIso: string, endIso: string): number {
  const [sy, sm, sd] = startIso.split('-').map(Number);
  const [ey, em, ed] = endIso.split('-').map(Number);
  let months = (ey - sy) * 12 + (em - sm);
  if (ed >= sd) months += 1;
  return months;
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string; yearId: string } },
) {
  const ctx = await getBookkeepingContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  if (ctx.userRole !== 'admin') {
    return NextResponse.json({ error: 'Only an admin can change the year-end.' }, { status: 403 });
  }

  const body = await req.json().catch(() => null) as { newEndDate?: string } | null;
  const newEndDate = body?.newEndDate?.trim() ?? '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(newEndDate)) {
    return NextResponse.json({ error: 'A valid new year-end date (yyyy-mm-dd) is required.' }, { status: 400 });
  }
  // Reject impossible calendar dates (e.g. 2026-02-30).
  const d = new Date(`${newEndDate}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== newEndDate) {
    return NextResponse.json({ error: 'That date does not exist.' }, { status: 400 });
  }

  const supabase = createClient();

  const { data: book, error: bookErr } = await supabase
    .from('bookkeeping_books')
    .select('id, firm_id, year_end_md, first_period_start')
    .eq('id', params.id)
    .eq('firm_id', ctx.firmId)
    .single();
  if (bookErr || !book) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // The year being changed.
  const { data: fy, error: fyErr } = await supabase
    .from('bookkeeping_financial_years')
    .select('id, book_id, start_date, end_date, status')
    .eq('id', params.yearId)
    .eq('book_id', params.id)
    .single();
  if (fyErr || !fy) return NextResponse.json({ error: 'Financial year not found' }, { status: 404 });

  if (fy.status === 'closed') {
    return NextResponse.json({ error: 'This financial year is closed — its boundaries are locked.' }, { status: 400 });
  }
  if (newEndDate <= fy.start_date) {
    return NextResponse.json(
      { error: `The new year-end must be after the year start (${fmtUk(fy.start_date)}).` },
      { status: 400 },
    );
  }

  // No later year may be closed — that would mean reordering across a close.
  const { data: laterClosed } = await supabase
    .from('bookkeeping_financial_years')
    .select('id')
    .eq('book_id', params.id)
    .gt('start_date', fy.start_date)
    .eq('status', 'closed')
    .limit(1);
  if (laterClosed && laterClosed.length > 0) {
    return NextResponse.json(
      { error: 'A later financial year is already closed. Reopen it before changing this year-end.' },
      { status: 400 },
    );
  }

  // ── Apply ──────────────────────────────────────────────────────────────
  // 1. Stretch/shrink this year to the new end date.
  const { error: updFyErr } = await supabase
    .from('bookkeeping_financial_years')
    .update({ end_date: newEndDate, updated_at: new Date().toISOString() })
    .eq('id', fy.id);
  if (updFyErr) return NextResponse.json({ error: updFyErr.message }, { status: 500 });

  // 2. Point the book's pattern at the new year-end so future years follow it.
  const newPatternMd = newEndDate.slice(5); // 'MM-DD'
  const { error: updBookErr } = await supabase
    .from('bookkeeping_books')
    .update({ year_end_md: newPatternMd, updated_at: new Date().toISOString() })
    .eq('id', params.id);
  if (updBookErr) return NextResponse.json({ error: updBookErr.message }, { status: 500 });

  // 3. Drop the (open, auto-generated) future years so they regenerate under
  //    the new pattern. None are closed (guarded above); transactions are
  //    date-scoped, not FK'd to FY rows, so nothing is lost.
  await supabase
    .from('bookkeeping_financial_years')
    .delete()
    .eq('book_id', params.id)
    .gt('start_date', fy.start_date);

  // 4. Regenerate forward from the new transition year-end.
  const { data: lastTxn } = await supabase
    .from('bookkeeping_transactions')
    .select('date')
    .eq('book_id', params.id)
    .order('date', { ascending: false })
    .limit(1)
    .maybeSingle();
  const todayIso = new Date().toISOString().slice(0, 10);
  const throughIso = (lastTxn?.date && lastTxn.date > todayIso) ? lastTxn.date : todayIso;
  await backfillForwardFys(supabase, params.id, {
    yearEndMd: newPatternMd,
    firstPeriodStart: book.first_period_start as string | null,
    throughIso,
  });

  // ── Non-blocking warnings ────────────────────────────────────────────────
  const warnings: string[] = [];
  const months = monthsBetween(fy.start_date, newEndDate);
  const lengthening = newEndDate > fy.end_date;
  if (months > 18) {
    warnings.push(
      `This is a ${months}-month period, longer than the 18-month Companies House maximum for a single accounting period.`,
    );
  }
  if (!lengthening && newEndDate < fy.end_date) {
    // Shortened — transactions after the new end roll into the next year.
    const { count } = await supabase
      .from('bookkeeping_transactions')
      .select('id', { count: 'exact', head: true })
      .eq('book_id', params.id)
      .gt('date', newEndDate)
      .lte('date', fy.end_date);
    if (count && count > 0) {
      warnings.push(
        `${count} transaction${count === 1 ? '' : 's'} dated after ${fmtUk(newEndDate)} now fall into the next financial year.`,
      );
    }
  }

  return NextResponse.json({
    ok: true,
    period: lengthening ? 'long' : 'short',
    months,
    start_date: fy.start_date,
    end_date: newEndDate,
    year_end_md: newPatternMd,
    warnings,
  });
}
