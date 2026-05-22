import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase-server';
import { getBookkeepingContext } from '@/lib/bookkeeping/server';

// ── POST /api/bookkeeping/books/[id]/matches ─────────────────────────────────
// Create a match linking transaction-splits together. v1 supports the two
// common cases:
//   • status='full'      — sum of debits === sum of credits across the picked
//                          splits (the typical invoice ↔ payment allocation)
//   • status='partial'   — debits ≠ credits, user has opted-in to a partial
//                          allocation (e.g. half-paid invoice)
//   • status='write_off' — the leftover side is being written off rather than
//                          matched against another split (separate POST flow)
//
// Phase 4A wires up 'full' end-to-end; 'partial' + 'write_off' land in 4B.

const CreateBody = z.object({
  split_ids: z.array(z.string().uuid()).min(2),
  status: z.enum(['full', 'partial', 'write_off']).default('full'),
  notes: z.string().max(500).nullable().optional(),
});

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getBookkeepingContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  let body: z.infer<typeof CreateBody>;
  try { body = CreateBody.parse(await req.json()); }
  catch (e) { return NextResponse.json({ error: 'Invalid payload', detail: String(e) }, { status: 400 }); }

  const supabase = createClient();

  // Confirm the book belongs to this firm.
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

  // Fetch the picked splits and validate they all belong to this book + share
  // the same account (typical allocation pattern: matching against ONE account).
  type SplitRow = {
    id: string;
    account_id: string;
    debit: number;
    credit: number;
    transaction: { book_id: string } | null;
  };
  const { data: splits, error: splitsErr } = await supabase
    .from('bookkeeping_transaction_splits')
    .select('id, account_id, debit, credit, transaction:bookkeeping_transactions!inner(book_id)')
    .in('id', body.split_ids);
  if (splitsErr) return NextResponse.json({ error: splitsErr.message }, { status: 500 });
  if (!splits || splits.length !== body.split_ids.length) {
    return NextResponse.json({ error: 'One or more splits not found' }, { status: 400 });
  }
  for (const s of splits as unknown as SplitRow[]) {
    if (s.transaction?.book_id !== params.id) {
      return NextResponse.json({ error: 'All splits must belong to this book' }, { status: 400 });
    }
  }
  const accountIds = new Set((splits as unknown as SplitRow[]).map(s => s.account_id));
  if (accountIds.size !== 1) {
    return NextResponse.json({ error: 'All splits must be on the same account' }, { status: 400 });
  }

  // Check none of the picked splits are already in a match.
  const { data: existing, error: existingErr } = await supabase
    .from('bookkeeping_match_lines')
    .select('split_id')
    .in('split_id', body.split_ids);
  if (existingErr) return NextResponse.json({ error: existingErr.message }, { status: 500 });
  if (existing && existing.length > 0) {
    return NextResponse.json(
      { error: `Already matched: ${(existing as { split_id: string }[]).map(e => e.split_id).join(', ')}` },
      { status: 409 },
    );
  }

  // Balance check for full matches
  const totalDr = (splits as unknown as SplitRow[]).reduce((s, x) => s + Number(x.debit), 0);
  const totalCr = (splits as unknown as SplitRow[]).reduce((s, x) => s + Number(x.credit), 0);
  if (body.status === 'full' && Math.abs(totalDr - totalCr) > 0.005) {
    return NextResponse.json(
      { error: `Selected entries don't balance — Dr ${totalDr.toFixed(2)} vs Cr ${totalCr.toFixed(2)}. Use partial match instead.` },
      { status: 400 },
    );
  }

  // Insert match header + lines
  const { data: match, error: matchErr } = await supabase
    .from('bookkeeping_matches')
    .insert({
      book_id: params.id,
      status: body.status,
      notes: body.notes ?? null,
      created_by: ctx.userId,
    })
    .select('id, status, notes, created_at')
    .single();
  if (matchErr || !match) {
    return NextResponse.json({ error: matchErr?.message ?? 'Match insert failed' }, { status: 500 });
  }

  const lineRows = body.split_ids.map(split_id => ({ match_id: match.id, split_id }));
  const { error: linesErr } = await supabase
    .from('bookkeeping_match_lines')
    .insert(lineRows);
  if (linesErr) {
    // Roll back the header
    await supabase.from('bookkeeping_matches').delete().eq('id', match.id);
    return NextResponse.json({ error: linesErr.message }, { status: 500 });
  }

  // Audit
  await supabase.from('bookkeeping_audit').insert({
    book_id: params.id,
    user_id: ctx.userId,
    entity_type: 'transaction',
    entity_id: null,
    action: 'create',
    diff: { match_id: match.id, status: body.status, split_ids: body.split_ids },
  });

  return NextResponse.json({ match });
}
