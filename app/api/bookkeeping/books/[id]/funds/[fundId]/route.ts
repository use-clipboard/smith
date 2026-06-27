import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase-server';
import { getBookkeepingContext } from '@/lib/bookkeeping/server';

type DB = ReturnType<typeof createClient>;

// Verify the fund belongs to a book in the requesting firm.
async function loadFund(supabase: DB, bookId: string, fundId: string, firmId: string) {
  const { data } = await supabase
    .from('bookkeeping_funds')
    .select('id, book_id, book:bookkeeping_books!inner(firm_id)')
    .eq('id', fundId).eq('book_id', bookId)
    .maybeSingle();
  if (!data) return null;
  const book = (data as unknown as { book?: { firm_id?: string } }).book;
  if (book?.firm_id !== firmId) return null;
  return data;
}

// Does this fund have any posted splits?
async function fundHasSplits(supabase: DB, fundId: string): Promise<boolean> {
  const { data } = await supabase
    .from('bookkeeping_transaction_splits')
    .select('id').eq('fund_id', fundId).limit(1).maybeSingle();
  return !!data;
}

// ── PATCH /api/bookkeeping/books/[id]/funds/[fundId] ──────────────────────────
const PatchBody = z.object({
  name: z.string().min(1).max(120).optional(),
  fund_type: z.enum(['unrestricted', 'restricted', 'endowment']).optional(),
  description: z.string().max(500).nullable().optional(),
  archived: z.boolean().optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: { id: string; fundId: string } }) {
  const ctx = await getBookkeepingContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  let body: z.infer<typeof PatchBody>;
  try { body = PatchBody.parse(await req.json()); }
  catch (e) { return NextResponse.json({ error: 'Invalid payload', detail: String(e) }, { status: 400 }); }

  const supabase = createClient();
  const fund = await loadFund(supabase, params.id, params.fundId, ctx.firmId);
  if (!fund) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // Changing the fund_type once it has entries would silently reclassify posted
  // figures between funds — block it.
  if (body.fund_type && await fundHasSplits(supabase, params.fundId)) {
    return NextResponse.json({ error: 'This fund already has entries — its type cannot be changed.' }, { status: 409 });
  }

  const patch: Record<string, unknown> = {};
  if (body.name !== undefined) patch.name = body.name.trim();
  if (body.fund_type !== undefined) patch.fund_type = body.fund_type;
  if (body.description !== undefined) patch.description = body.description?.trim() || null;
  if (body.archived !== undefined) patch.archived = body.archived;
  if (Object.keys(patch).length === 0) return NextResponse.json({ error: 'Nothing to update.' }, { status: 400 });

  const { data, error } = await supabase
    .from('bookkeeping_funds').update(patch).eq('id', params.fundId)
    .select('id, book_id, name, fund_type, description, sort_order, archived, created_by, created_at')
    .single();
  if (error) {
    if (error.code === '23505') return NextResponse.json({ error: 'A fund with that name already exists.' }, { status: 409 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ fund: data });
}

// ── DELETE /api/bookkeeping/books/[id]/funds/[fundId] ─────────────────────────
// Refuses to delete a fund that has any posted splits (would orphan entries).
export async function DELETE(_req: NextRequest, { params }: { params: { id: string; fundId: string } }) {
  const ctx = await getBookkeepingContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const supabase = createClient();
  const fund = await loadFund(supabase, params.id, params.fundId, ctx.firmId);
  if (!fund) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  if (await fundHasSplits(supabase, params.fundId)) {
    return NextResponse.json({ error: 'This fund has entries and cannot be deleted. Archive it instead.' }, { status: 409 });
  }

  const { error } = await supabase.from('bookkeeping_funds').delete().eq('id', params.fundId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
