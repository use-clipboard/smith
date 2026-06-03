import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { getBookkeepingContext } from '@/lib/bookkeeping/server';

// ── GET /api/bookkeeping/books/[id]/matches/[matchId] ───────────────────────
// Returns EVERY split in a match, regardless of date/period. The ledger view
// only holds the splits for the currently-selected period in memory, so a
// match that straddles two periods (e.g. a reversing journal and its reversal)
// would otherwise show only the in-period leg in the allocation modal. This
// endpoint is the source of truth for "what's in this allocation".

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string; matchId: string } },
) {
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

  type LineRow = {
    split_id: string;
    split: {
      id: string;
      debit: number;
      credit: number;
      entry_details: string | null;
      transaction: { id: string; ref_no: string; date: string; details: string | null; book_id: string } | null;
    } | null;
  };
  const { data, error } = await supabase
    .from('bookkeeping_match_lines')
    .select(`
      split_id,
      split:bookkeeping_transaction_splits!inner(
        id, debit, credit, entry_details,
        transaction:bookkeeping_transactions!inner(id, ref_no, date, details, book_id)
      )
    `)
    .eq('match_id', params.matchId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const lines = (data as unknown as LineRow[])
    .filter(l => l.split?.transaction?.book_id === params.id)
    .map(l => ({
      split_id: l.split_id,
      transaction_id: l.split!.transaction!.id,
      ref_no: l.split!.transaction!.ref_no,
      date: l.split!.transaction!.date,
      details: l.split!.transaction!.details,
      entry_details: l.split!.entry_details,
      debit: Number(l.split!.debit),
      credit: Number(l.split!.credit),
    }))
    .sort((a, b) => a.date.localeCompare(b.date));

  return NextResponse.json({ lines });
}

// ── DELETE /api/bookkeeping/books/[id]/matches/[matchId] ────────────────────
// Un-match a previously allocated set of splits. The match_lines cascade
// delete with the parent match; the underlying transactions are untouched.

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string; matchId: string } },
) {
  const ctx = await getBookkeepingContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const supabase = createClient();
  const { data: book, error: bookErr } = await supabase
    .from('bookkeeping_books')
    .select('id, firm_id, admin_locked')
    .eq('id', params.id)
    .eq('firm_id', ctx.firmId)
    .single();
  if (bookErr || !book) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (book.admin_locked && ctx.userRole !== 'admin') {
    return NextResponse.json({ error: 'Book is admin-locked' }, { status: 403 });
  }

  // Capture the lines for the audit diff before they cascade away.
  const { data: lines } = await supabase
    .from('bookkeeping_match_lines')
    .select('split_id')
    .eq('match_id', params.matchId);

  const { error } = await supabase
    .from('bookkeeping_matches')
    .delete()
    .eq('id', params.matchId)
    .eq('book_id', params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await supabase.from('bookkeeping_audit').insert({
    book_id: params.id,
    user_id: ctx.userId,
    entity_type: 'transaction',
    entity_id: null,
    action: 'delete',
    diff: { match_id: params.matchId, split_ids: (lines ?? []).map(l => (l as { split_id: string }).split_id) },
  });

  return NextResponse.json({ ok: true });
}
