import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase-server';
import { getBookkeepingContext } from '@/lib/bookkeeping/server';

// ── POST /api/bookkeeping/books/[id]/bank-imports/[importId]/unclear-splits
// Bulk-untick splits in this rec. Only un-clears splits that ARE cleared
// in THIS rec — silently skips others so the action is idempotent.
//
// Body: { split_ids: string[] }
// Returns: { uncleared: number }

const Body = z.object({
  split_ids: z.array(z.string().uuid()).min(1).max(10_000),
});

/** Match clear-splits — 200 IDs per chunk keeps each PostgREST URL well
 *  under the ~8 KB edge-proxy cap. 38 chars/UUID × 200 ≈ 7.4 KB which
 *  fits with query-string overhead and headers. Higher chunks bounce
 *  with "fetch failed" at the edge before the request reaches Supabase. */
const IN_CHUNK = 200;

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string; importId: string } },
) {
  const ctx = await getBookkeepingContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  let body: z.infer<typeof Body>;
  try { body = Body.parse(await req.json()); }
  catch (e) { return NextResponse.json({ error: 'Invalid payload', detail: String(e) }, { status: 400 }); }

  const supabase = createClient();

  // ── Firm + book + rec gate ─────────────────────────────────────────────
  const { data: imp } = await supabase
    .from('bookkeeping_bank_imports')
    .select('id, book_id, status, book:bookkeeping_books!inner(firm_id)')
    .eq('id', params.importId)
    .eq('book_id', params.id)
    .single();
  if (!imp) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  // @ts-expect-error — !inner guarantees the join
  if (imp.book.firm_id !== ctx.firmId) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  if (imp.status === 'reconciled' || imp.status === 'abandoned') {
    return NextResponse.json({
      error: `Cannot change clearings on a ${imp.status} reconciliation. Reopen it first.`,
    }, { status: 409 });
  }

  // ── Apply the un-clearing (chunked UPDATE) ─────────────────────────────
  // Scoped to this rec id so we never accidentally untick something
  // cleared in a different rec (the unique-rec check on POST should make
  // this impossible anyway, but defence in depth).
  const unclearedIds: string[] = [];
  for (let i = 0; i < body.split_ids.length; i += IN_CHUNK) {
    const chunk = body.split_ids.slice(i, i + IN_CHUNK);
    const { data, error } = await supabase
      .from('bookkeeping_transaction_splits')
      .update({ cleared_in_rec_id: null, cleared_at: null })
      .in('id', chunk)
      .eq('cleared_in_rec_id', params.importId)
      .select('id');
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    unclearedIds.push(...((data ?? []).map(r => r.id as string)));
  }

  // Also drop any bookkeeping_bank_lines link pointing at these splits, so
  // a re-cleared statement line can be re-paired cleanly. (Lines themselves
  // are kept — the statement upload is independent of the clearing state.)
  if (unclearedIds.length > 0) {
    for (let i = 0; i < unclearedIds.length; i += IN_CHUNK) {
      const chunk = unclearedIds.slice(i, i + IN_CHUNK);
      await supabase
        .from('bookkeeping_bank_lines')
        .update({ matched_split_id: null, reconciled_at: null, reconciled_by: null })
        .in('matched_split_id', chunk);
    }
  }

  // If we just un-cleared the last remaining split, drop the rec status
  // back to 'pending' so the UI reflects "nothing ticked yet". Cheap one-
  // row probe — we don't need the count, just "does any cleared row exist?"
  const { data: stillCleared } = await supabase
    .from('bookkeeping_transaction_splits')
    .select('id')
    .eq('cleared_in_rec_id', params.importId)
    .limit(1)
    .maybeSingle();
  if (!stillCleared && imp.status === 'in_progress') {
    await supabase
      .from('bookkeeping_bank_imports')
      .update({ status: 'pending' })
      .eq('id', params.importId);
  }

  return NextResponse.json({ uncleared: unclearedIds.length });
}
