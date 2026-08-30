// Backfill forward financial-year rows for a book.
//
// Unlike a naive "regenerate every FY from one pattern" approach, this anchors
// on the LATEST existing FY row and only ever extends *forward*. Stored
// boundaries — including a long/short transition year created by a year-end
// change — are therefore authoritative and never regenerated or shifted. When
// the book has no FY rows yet, it seeds from `firstPeriodStart` (honouring a
// short first year via enumerateFys). Existing rows are never modified.

import type { SupabaseClient } from '@supabase/supabase-js';
import { parseYearEndMd, enumerateFys, addDay, fyContaining } from '@/lib/bookkeeping/financialYears';

export async function backfillForwardFys(
  supabase: SupabaseClient,
  bookId: string,
  opts: { yearEndMd: string | null; firstPeriodStart: string | null; throughIso: string },
): Promise<void> {
  const pattern = parseYearEndMd(opts.yearEndMd);
  if (!pattern) return;

  // Prune empty future placeholders — but keep ONE year beyond the current
  // period. Any FY starting past `throughIso` has no transactions (a
  // transaction there would have pushed throughIso to cover it), so dropping
  // the far-future ones just declutters; they regenerate on demand.
  //
  // The immediately-next year is deliberately spared, because the user can now
  // create it by hand from the Financial years dialog and it must survive the
  // next page load — this generator runs on every book open. Generation itself
  // still never creates it (enumerateFys only reaches throughIso), so an
  // untouched book gains nothing here.
  //
  // Only ever touches plain 'open' rows; closed/reopened years are in the past
  // and never match this filter.
  const currentFy = fyContaining(pattern, opts.throughIso);
  const nextFyStart = addDay(currentFy.end);
  await supabase
    .from('bookkeeping_financial_years')
    .delete()
    .eq('book_id', bookId)
    .eq('status', 'open')
    .gt('start_date', nextFyStart);

  const { data: existing } = await supabase
    .from('bookkeeping_financial_years')
    .select('start_date, end_date')
    .eq('book_id', bookId)
    .order('start_date', { ascending: true });
  const rows = (existing ?? []) as { start_date: string; end_date: string }[];

  // Anchor on the last stored year's end (+1 day), or seed from the book's
  // first period start when there are no years yet.
  const anchorStart = rows.length > 0
    ? addDay(rows[rows.length - 1].end_date)
    : opts.firstPeriodStart;
  if (!anchorStart) return;

  // enumerateFys's first range starts exactly at `anchorStart`; every range
  // after it aligns to the current pattern. So forward years following a
  // year-end change pick up the new pattern automatically.
  const desired = enumerateFys(pattern, anchorStart, opts.throughIso);
  const existingStarts = new Set(rows.map(r => r.start_date));
  const toInsert = desired
    .filter(r => !existingStarts.has(r.start))
    .map(r => ({ book_id: bookId, start_date: r.start, end_date: r.end, status: 'open' as const }));

  if (toInsert.length > 0) {
    await supabase.from('bookkeeping_financial_years').insert(toInsert);
  }
}
