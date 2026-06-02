import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { getBookkeepingContext } from '@/lib/bookkeeping/server';
import { backfillForwardFys } from '@/lib/bookkeeping/generateFys';

// ── /api/bookkeeping/books/[id]/years ──────────────────────────────────────
// GET → list every FY row for the book in chronological order. With
// `?generate=true`, the endpoint also back-fills any FY rows that *should*
// exist (based on the book's year_end_md + first_period_start + the latest
// transaction date) but are missing from the table. Generation is a no-op
// when the book has no year_end_md set yet.

const SELECT = `
  id, book_id, start_date, end_date, status,
  closed_at, closed_by, closing_journal_id,
  reopened_at, reopened_by, reopen_reason,
  created_at, updated_at
`;

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getBookkeepingContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const url = new URL(req.url);
  const shouldGenerate = url.searchParams.get('generate') === 'true';

  const supabase = createClient();

  const { data: book, error: bookErr } = await supabase
    .from('bookkeeping_books')
    .select('id, firm_id, year_end_md, first_period_start')
    .eq('id', params.id)
    .eq('firm_id', ctx.firmId)
    .single();
  if (bookErr || !book) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // ── Optional back-fill ────────────────────────────────────────────────
  if (shouldGenerate && book.year_end_md) {
    // Decide the "first start" — book.first_period_start when set, otherwise
    // the earliest transaction date, otherwise today. Only used to seed a
    // brand-new book; once any FY row exists, generation anchors on it.
    let firstStart = book.first_period_start as string | null;
    if (!firstStart) {
      const { data: firstTxn } = await supabase
        .from('bookkeeping_transactions')
        .select('date')
        .eq('book_id', params.id)
        .order('date', { ascending: true })
        .limit(1)
        .maybeSingle();
      firstStart = firstTxn?.date ?? new Date().toISOString().slice(0, 10);
      // Persist it so subsequent generations are stable.
      await supabase
        .from('bookkeeping_books')
        .update({ first_period_start: firstStart })
        .eq('id', params.id);
    }

    // Extend up to whichever is later: the latest transaction date, or today
    // (the current period). We deliberately do NOT pre-create next year —
    // later years materialise on demand the moment a transaction is posted
    // into them (the latest-transaction reach above covers that), so the UI
    // isn't cluttered with empty future placeholders.
    const { data: lastTxn } = await supabase
      .from('bookkeeping_transactions')
      .select('date')
      .eq('book_id', params.id)
      .order('date', { ascending: false })
      .limit(1)
      .maybeSingle();
    const todayIso = new Date().toISOString().slice(0, 10);
    const throughIso = (lastTxn?.date && lastTxn.date > todayIso) ? lastTxn.date : todayIso;

    // Anchored generation: never regenerates/shifts existing rows, only
    // extends forward from the latest stored FY using the current pattern.
    await backfillForwardFys(supabase, params.id, {
      yearEndMd: book.year_end_md,
      firstPeriodStart: firstStart,
      throughIso,
    });
  }

  const { data: years, error } = await supabase
    .from('bookkeeping_financial_years')
    .select(SELECT)
    .eq('book_id', params.id)
    .order('start_date', { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ years: years ?? [] });
}
