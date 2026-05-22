import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { getBookkeepingContext } from '@/lib/bookkeeping/server';

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
