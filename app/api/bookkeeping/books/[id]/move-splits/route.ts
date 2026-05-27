import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase-server';
import { getBookkeepingContext } from '@/lib/bookkeeping/server';

// ── POST /api/bookkeeping/books/[id]/move-splits ─────────────────────────────
//
// Moves the chosen splits to a different account — the "Move entries to
// another account" action in the ledger view (mirrors VT's dialog of the
// same name). Used when a user has posted transactions to the wrong
// account and wants to redirect a batch in one click.
//
// Match handling:
//   • A bookkeeping_match's splits must all live on the same account
//     (enforced by /matches POST). So if any input split belongs to a
//     match, we automatically pull in ALL of that match's other splits
//     and move them together. Otherwise the match would silently span
//     two accounts, breaking the open-entries view.
//   • Net result for the user: clicking Move on any matched entry moves
//     the entire allocation. Exactly what VT does and what the user
//     described ("turn the rows yellow … will move all the matched
//     entries in one").

const Body = z.object({
  split_ids: z.array(z.string().uuid()).min(1),
  target_account_id: z.string().uuid(),
});

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getBookkeepingContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  let body: z.infer<typeof Body>;
  try { body = Body.parse(await req.json()); }
  catch (e) { return NextResponse.json({ error: 'Invalid payload', detail: String(e) }, { status: 400 }); }

  const supabase = createClient();

  // ── 1. Book + lock gates ─────────────────────────────────────────────────
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

  // ── 2. Target account check ──────────────────────────────────────────────
  const { data: targetAcc, error: accErr } = await supabase
    .from('bookkeeping_accounts')
    .select('id, name, ledger, inactive, archived, system_managed, book_id')
    .eq('id', body.target_account_id)
    .single();
  if (accErr || !targetAcc) {
    return NextResponse.json({ error: 'Target account not found' }, { status: 404 });
  }
  if (targetAcc.book_id !== params.id) {
    return NextResponse.json({ error: 'Target account belongs to a different book' }, { status: 400 });
  }
  if (targetAcc.archived) {
    return NextResponse.json({ error: 'Target account is archived' }, { status: 400 });
  }
  if (targetAcc.inactive) {
    return NextResponse.json({ error: `Target account "${targetAcc.name}" is locked for new entries — unlock it in Properties first.` }, { status: 400 });
  }
  if (targetAcc.system_managed) {
    return NextResponse.json({ error: `Target account "${targetAcc.name}" is system-managed and can't receive manual moves.` }, { status: 400 });
  }

  // ── 3. Load the input splits (verify they belong to the book) ────────────
  const { data: inputSplits, error: inErr } = await supabase
    .from('bookkeeping_transaction_splits')
    .select('id, account_id, transaction:bookkeeping_transactions!inner(book_id)')
    .in('id', body.split_ids);
  if (inErr) return NextResponse.json({ error: inErr.message }, { status: 500 });
  if (!inputSplits || inputSplits.length !== body.split_ids.length) {
    return NextResponse.json({ error: 'One or more splits not found' }, { status: 400 });
  }
  for (const s of inputSplits as unknown as Array<{ id: string; account_id: string; transaction: { book_id: string } }>) {
    if (s.transaction.book_id !== params.id) {
      return NextResponse.json({ error: 'All splits must belong to this book' }, { status: 400 });
    }
  }

  // ── 4. Expand to include sibling matched splits ──────────────────────────
  // A match must always sit on a single account, so moving a single matched
  // split would silently break that invariant. Pull every sibling of every
  // match touched by the input set.
  const inputIds = new Set<string>(body.split_ids);
  const { data: matchLines } = await supabase
    .from('bookkeeping_match_lines')
    .select('match_id, split_id')
    .in('split_id', body.split_ids);
  const matchIds = [...new Set((matchLines ?? []).map(m => m.match_id as string))];
  if (matchIds.length > 0) {
    const { data: siblingLines } = await supabase
      .from('bookkeeping_match_lines')
      .select('split_id')
      .in('match_id', matchIds);
    for (const r of siblingLines ?? []) inputIds.add(r.split_id as string);
  }
  const allSplitIdsToMove = [...inputIds];

  // ── 5. Move ──────────────────────────────────────────────────────────────
  // Single UPDATE — efficient even for hundreds of rows. The splits' parent
  // transactions are unaffected; we're only changing which account each
  // leg posts to. Balances/TB/P&L recompute from the new account_id on next
  // fetch.
  const { error: updErr, count } = await supabase
    .from('bookkeeping_transaction_splits')
    .update({ account_id: body.target_account_id }, { count: 'exact' })
    .in('id', allSplitIdsToMove);
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });

  // ── 6. Audit ─────────────────────────────────────────────────────────────
  await supabase.from('bookkeeping_audit').insert({
    book_id: params.id,
    user_id: ctx.userId,
    entity_type: 'account',
    entity_id: body.target_account_id,
    action: 'update',
    diff: {
      moved_splits: allSplitIdsToMove.length,
      target_account_id: body.target_account_id,
      target_account_name: `${targetAcc.ledger ?? ''}: ${targetAcc.name}`,
      expanded_matches: matchIds.length,
    },
  });

  return NextResponse.json({
    ok: true,
    moved_count: count ?? allSplitIdsToMove.length,
    expanded_matches: matchIds.length,
    expanded_split_count: allSplitIdsToMove.length - body.split_ids.length,
  });
}
