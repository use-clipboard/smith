import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase-server';
import { getBookkeepingContext } from '@/lib/bookkeeping/server';

// ── POST /api/bookkeeping/books/[id]/matches/[matchId]/remove-lines ──────────
// Selective un-match. Removes the listed splits from the match. If fewer
// than 2 lines remain after removal, the entire match is deleted (a single-
// line "match" makes no sense).
//
// Body: { split_ids: [uuid, uuid, ...] }
//
// Returns { ok: true, match_deleted: boolean, remaining_lines: number }.

const Body = z.object({
  split_ids: z.array(z.string().uuid()).min(1),
});

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string; matchId: string } },
) {
  const ctx = await getBookkeepingContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  let body: z.infer<typeof Body>;
  try { body = Body.parse(await req.json()); }
  catch (e) { return NextResponse.json({ error: 'Invalid payload', detail: String(e) }, { status: 400 }); }

  const supabase = createClient();

  // Verify the book + admin-lock status
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

  // Verify the match belongs to this book
  const { data: match, error: matchErr } = await supabase
    .from('bookkeeping_matches')
    .select('id, book_id')
    .eq('id', params.matchId)
    .eq('book_id', params.id)
    .single();
  if (matchErr || !match) return NextResponse.json({ error: 'Match not found' }, { status: 404 });

  // Remove the requested lines
  const { error: delErr } = await supabase
    .from('bookkeeping_match_lines')
    .delete()
    .eq('match_id', params.matchId)
    .in('split_id', body.split_ids);
  if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 });

  // How many lines remain?
  const { count, error: countErr } = await supabase
    .from('bookkeeping_match_lines')
    .select('id', { count: 'exact', head: true })
    .eq('match_id', params.matchId);
  if (countErr) return NextResponse.json({ error: countErr.message }, { status: 500 });

  let matchDeleted = false;
  if ((count ?? 0) < 2) {
    // A single-line "match" is meaningless — collapse it entirely.
    const { error: matchDelErr } = await supabase
      .from('bookkeeping_matches')
      .delete()
      .eq('id', params.matchId);
    if (matchDelErr) return NextResponse.json({ error: matchDelErr.message }, { status: 500 });
    matchDeleted = true;
  }

  await supabase.from('bookkeeping_audit').insert({
    book_id: params.id,
    user_id: ctx.userId,
    entity_type: 'transaction',
    entity_id: null,
    action: 'update',
    diff: {
      match_id: params.matchId,
      removed_split_ids: body.split_ids,
      match_deleted: matchDeleted,
    },
  });

  return NextResponse.json({
    ok: true,
    match_deleted: matchDeleted,
    remaining_lines: count ?? 0,
  });
}
