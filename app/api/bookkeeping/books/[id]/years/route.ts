import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { getBookkeepingContext } from '@/lib/bookkeeping/server';
import { backfillForwardFys } from '@/lib/bookkeeping/generateFys';
import { parseYearEndMd, fyEndOnOrAfter, fyContaining, addDay } from '@/lib/bookkeeping/financialYears';

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

  const rows = (years ?? []) as Array<{ end_date: string }>;
  return NextResponse.json({
    years: rows,
    // The year an "Add next year" would create, or null when one isn't
    // allowed. Computed here so the UI never offers a year the generator
    // would then prune away — see nextAddableYear.
    next_year: nextAddableYear(book.year_end_md, rows, book.first_period_start),
  });
}

/**
 * The next financial year that may be added, or null if none may be.
 *
 * Books run one year ahead at most. The generator prunes empty placeholders
 * further out than that on every book load, so offering a second year would be
 * offering one that silently disappears — worse than not offering it. The
 * limit here is deliberately the same test the pruner uses.
 */
function nextAddableYear(
  yearEndMd: string | null,
  rows: Array<{ end_date: string }>,
  firstPeriodStart: string | null,
): { start: string; end: string } | null {
  const pattern = parseYearEndMd(yearEndMd);
  if (!pattern) return null;

  const latestEnd = rows.length > 0 ? rows[rows.length - 1].end_date : null;
  const start = latestEnd ? addDay(latestEnd) : firstPeriodStart;
  if (!start) return null;

  // One year beyond the period we're currently in, and no further.
  const todayIso = new Date().toISOString().slice(0, 10);
  const nextFyStart = addDay(fyContaining(pattern, todayIso).end);
  if (start > nextFyStart) return null;

  return { start, end: fyEndOnOrAfter(pattern, start) };
}

// ── POST ────────────────────────────────────────────────────────────────────
// Append the NEXT financial year after the latest one, following the book's
// year-end pattern.
//
// Deliberately "next" rather than "any dates you like": years close and reopen
// in date order, and the whole engine assumes a contiguous run of periods, so
// letting someone type arbitrary dates would invite gaps and overlaps that
// quietly break closing. Adding one year at a time can produce neither.
//
// Admin-only, matching close/reopen — this is structural, not day-to-day work.
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getBookkeepingContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  if (ctx.userRole !== 'admin') {
    return NextResponse.json({ error: 'Only an admin can add a financial year.' }, { status: 403 });
  }

  const supabase = createClient();
  const { data: book, error: bookErr } = await supabase
    .from('bookkeeping_books')
    .select('id, firm_id, year_end_md, first_period_start')
    .eq('id', params.id)
    .eq('firm_id', ctx.firmId)
    .single();
  if (bookErr || !book) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  if (!parseYearEndMd(book.year_end_md)) {
    return NextResponse.json(
      { error: 'Set the book’s year end first — the new year is worked out from it.' },
      { status: 400 },
    );
  }

  const { data: latest } = await supabase
    .from('bookkeeping_financial_years')
    .select('end_date')
    .eq('book_id', params.id)
    .order('start_date', { ascending: false })
    .limit(1)
    .maybeSingle();

  // Same rule the list endpoint advertises and the generator prunes by, so the
  // three can't drift apart.
  const next = nextAddableYear(
    book.year_end_md,
    latest?.end_date ? [{ end_date: latest.end_date as string }] : [],
    book.first_period_start as string | null,
  );
  if (!next) {
    return NextResponse.json(
      {
        error: latest
          ? 'This book already runs a year ahead — close into it before adding another.'
          : 'This book has no periods yet — post a transaction or set a first period start.',
      },
      { status: 400 },
    );
  }
  const { start, end } = next;

  // Belt and braces against a double-click racing itself.
  const { data: clash } = await supabase
    .from('bookkeeping_financial_years')
    .select('id')
    .eq('book_id', params.id)
    .eq('start_date', start)
    .maybeSingle();
  if (clash) {
    return NextResponse.json({ error: 'That financial year already exists.' }, { status: 409 });
  }

  const { data: created, error: insErr } = await supabase
    .from('bookkeeping_financial_years')
    .insert({ book_id: params.id, start_date: start, end_date: end, status: 'open' })
    .select(SELECT)
    .single();
  if (insErr || !created) {
    return NextResponse.json({ error: insErr?.message ?? 'Could not add the year' }, { status: 500 });
  }

  await supabase.from('bookkeeping_audit').insert({
    book_id: params.id,
    user_id: ctx.userId,
    entity_type: 'financial_year',
    entity_id: created.id,
    action: 'create',
    diff: { kind: 'add_financial_year', start_date: start, end_date: end },
  });

  return NextResponse.json({ year: created });
}
