import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase-server';
import { getBookkeepingContext } from '@/lib/bookkeeping/server';

// ── /api/bookkeeping/books/[id]/ledgers ─────────────────────────────────────
// Ledgers are not a first-class table — they're the distinct `ledger` values
// across the book's accounts. This endpoint surfaces them as a list (with
// account counts) for the Move-account picker and the admin "Set Up Ledgers"
// dialog, and lets admins rename a ledger (cascades over every account in it)
// or empty-delete one (only allowed when zero accounts use it).
//
// We deliberately don't expose "create ledger" — admins create one implicitly
// by moving/creating an account into a brand-new ledger name.

interface LedgerSummary { name: string; account_count: number }

async function loadBook(supabase: ReturnType<typeof createClient>, bookId: string, firmId: string) {
  const { data } = await supabase
    .from('bookkeeping_books').select('id, admin_locked').eq('id', bookId).eq('firm_id', firmId).single();
  return data;
}

// ── GET ─────────────────────────────────────────────────────────────────────
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getBookkeepingContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const supabase = createClient();
  const book = await loadBook(supabase, params.id, ctx.firmId);
  if (!book) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const { data, error } = await supabase
    .from('bookkeeping_accounts')
    .select('ledger')
    .eq('book_id', params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const counts = new Map<string, number>();
  for (const row of data ?? []) {
    const k = (row.ledger ?? '').trim();
    if (!k) continue;
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const ledgers: LedgerSummary[] = [...counts.entries()]
    .map(([name, account_count]) => ({ name, account_count }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return NextResponse.json({ ledgers });
}

// ── PATCH ───────────────────────────────────────────────────────────────────
// Rename a ledger across every account in the book. Admin-only because this
// is a COA-structure change. Body: { from: oldName, to: newName }.
const PatchBody = z.object({
  from: z.string().min(1).max(100),
  to:   z.string().min(1).max(100),
});

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getBookkeepingContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  if (ctx.userRole !== 'admin') return NextResponse.json({ error: 'Only admins can rename ledgers' }, { status: 403 });

  let body: z.infer<typeof PatchBody>;
  try { body = PatchBody.parse(await req.json()); }
  catch (e) { return NextResponse.json({ error: 'Invalid payload', detail: String(e) }, { status: 400 }); }

  const from = body.from.trim();
  const to   = body.to.trim();
  if (from === to) return NextResponse.json({ ok: true, updated: 0 });

  const supabase = createClient();
  const book = await loadBook(supabase, params.id, ctx.firmId);
  if (!book) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // Reject rename if destination already exists AND there's a name collision
  // (because of the (book_id, ledger, name) uniqueness constraint).
  const { data: dest } = await supabase
    .from('bookkeeping_accounts').select('name').eq('book_id', params.id).eq('ledger', to);
  if (dest && dest.length > 0) {
    const { data: src } = await supabase
      .from('bookkeeping_accounts').select('name').eq('book_id', params.id).eq('ledger', from);
    const destNames = new Set((dest ?? []).map(r => r.name));
    const collisions = (src ?? []).map(r => r.name).filter(n => destNames.has(n));
    if (collisions.length > 0) {
      return NextResponse.json(
        { error: `Can’t merge — accounts with the same name exist in both ledgers: ${collisions.join(', ')}. Rename or move those first.` },
        { status: 409 },
      );
    }
  }

  const { data: updated, error } = await supabase
    .from('bookkeeping_accounts')
    .update({ ledger: to })
    .eq('book_id', params.id)
    .eq('ledger', from)
    .select('id');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await supabase.from('bookkeeping_audit').insert({
    book_id: params.id,
    user_id: ctx.userId,
    entity_type: 'account',
    entity_id: null,
    action: 'update',
    diff: { ledger_rename: { from, to }, account_ids: (updated ?? []).map(r => r.id) },
  });

  return NextResponse.json({ ok: true, updated: updated?.length ?? 0 });
}
