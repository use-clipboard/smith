import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase-server';
import { getBookkeepingContext } from '@/lib/bookkeeping/server';

// ── POST /api/bookkeeping/books/[id]/bank-imports/[importId]/clear-splits ──
// Bulk-tick ledger splits as cleared in this rec. Idempotent — already-
// cleared splits are skipped, splits cleared in OTHER recs are rejected.
//
// Body: { split_ids: string[] }
// Returns: { cleared: number, skipped: { id, reason }[] }

const Body = z.object({
  // Practical cap of 10k IDs per request — that's enough for a "Clear all
  // brought forward" on a freshly migrated book. We chunk PostgREST .in()
  // calls below so the actual SQL stays well inside its parameter limits.
  split_ids: z.array(z.string().uuid()).min(1).max(10_000),
});

/** PostgREST URL-length practical cap when using .in() — Vercel /
 *  Cloudflare edge layers in front of Supabase typically reject URLs
 *  above ~8 KB. At 38 chars per UUID + comma, 200 IDs gives ~7.4 KB which
 *  fits comfortably with the rest of the query string and headers. We hit
 *  "TypeError: fetch failed" with the previous 500-per-chunk size on a
 *  404-row bulk clear because the URL exceeded the edge proxy's cap. */
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
    .select('id, book_id, account_id, status, book:bookkeeping_books!inner(firm_id)')
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

  // ── Fetch the candidate splits and validate each ───────────────────────
  // Chunked .in() — at ~38 chars per UUID, a single .in(…) clause with
  // thousands of IDs would blow past PostgREST's URL-length limit. Same
  // for the UPDATE below.
  type Row = { id: string; account_id: string; cleared_in_rec_id: string | null };
  const rows: Row[] = [];
  for (let i = 0; i < body.split_ids.length; i += IN_CHUNK) {
    const chunk = body.split_ids.slice(i, i + IN_CHUNK);
    const { data, error } = await supabase
      .from('bookkeeping_transaction_splits')
      .select('id, account_id, cleared_in_rec_id')
      .in('id', chunk);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    rows.push(...((data ?? []) as Row[]));
  }
  const byId = new Map(rows.map(r => [r.id, r]));

  const skipped: { id: string; reason: string }[] = [];
  const toClear: string[] = [];

  for (const id of body.split_ids) {
    const row = byId.get(id);
    if (!row) { skipped.push({ id, reason: 'Split not found' }); continue; }
    if (row.account_id !== imp.account_id) {
      skipped.push({ id, reason: 'Split is on a different account' });
      continue;
    }
    if (row.cleared_in_rec_id && row.cleared_in_rec_id !== params.importId) {
      skipped.push({ id, reason: 'Already cleared in another reconciliation' });
      continue;
    }
    if (row.cleared_in_rec_id === params.importId) continue; // already cleared here — idempotent
    toClear.push(id);
  }

  // ── Apply the clearings (chunked) ──────────────────────────────────────
  if (toClear.length > 0) {
    const stamp = new Date().toISOString();
    for (let i = 0; i < toClear.length; i += IN_CHUNK) {
      const chunk = toClear.slice(i, i + IN_CHUNK);
      const { error } = await supabase
        .from('bookkeeping_transaction_splits')
        .update({ cleared_in_rec_id: params.importId, cleared_at: stamp })
        .in('id', chunk);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }

  // ── Bump rec status pending → in_progress on first clearing ────────────
  if (imp.status === 'pending' && toClear.length > 0) {
    await supabase
      .from('bookkeeping_bank_imports')
      .update({ status: 'in_progress' })
      .eq('id', params.importId);
  }

  return NextResponse.json({ cleared: toClear.length, skipped });
}
