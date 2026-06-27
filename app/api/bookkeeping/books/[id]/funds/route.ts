import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase-server';
import { getBookkeepingContext } from '@/lib/bookkeeping/server';

type DB = ReturnType<typeof createClient>;

// Verify the book belongs to the requesting firm.
async function loadBook(supabase: DB, bookId: string, firmId: string) {
  const { data } = await supabase
    .from('bookkeeping_books')
    .select('id, firm_id, template_type')
    .eq('id', bookId).eq('firm_id', firmId)
    .maybeSingle();
  return data ?? null;
}

// Fund ids that have at least one posted split on this book.
async function usedFundIds(supabase: DB, bookId: string): Promise<Set<string>> {
  const { data } = await supabase
    .from('bookkeeping_transaction_splits')
    .select('fund_id, transaction:bookkeeping_transactions!inner(book_id)')
    .eq('transaction.book_id', bookId)
    .not('fund_id', 'is', null);
  const set = new Set<string>();
  for (const r of (data ?? []) as Array<{ fund_id: string | null }>) {
    if (r.fund_id) set.add(r.fund_id);
  }
  return set;
}

// ── GET /api/bookkeeping/books/[id]/funds ────────────────────────────────────
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getBookkeepingContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const supabase = createClient();
  const book = await loadBook(supabase, params.id, ctx.firmId);
  if (!book) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const [{ data: funds, error }, used] = await Promise.all([
    supabase.from('bookkeeping_funds')
      .select('id, book_id, name, fund_type, description, sort_order, archived, created_by, created_at')
      .eq('book_id', params.id)
      .order('sort_order', { ascending: true }).order('created_at', { ascending: true }),
    usedFundIds(supabase, params.id),
  ]);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const withUse = (funds ?? []).map(f => ({ ...f, in_use: used.has(f.id) }));
  return NextResponse.json({ funds: withUse });
}

// ── POST /api/bookkeeping/books/[id]/funds ───────────────────────────────────
const CreateBody = z.object({
  name: z.string().min(1).max(120),
  fund_type: z.enum(['unrestricted', 'restricted', 'endowment']),
  description: z.string().max(500).nullable().optional(),
});

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getBookkeepingContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  let body: z.infer<typeof CreateBody>;
  try { body = CreateBody.parse(await req.json()); }
  catch (e) { return NextResponse.json({ error: 'Invalid payload', detail: String(e) }, { status: 400 }); }

  const supabase = createClient();
  const book = await loadBook(supabase, params.id, ctx.firmId);
  if (!book) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // Next sort_order = max + 1.
  const { data: last } = await supabase
    .from('bookkeeping_funds').select('sort_order')
    .eq('book_id', params.id).order('sort_order', { ascending: false }).limit(1).maybeSingle();
  const sortOrder = (last?.sort_order ?? -1) + 1;

  const { data, error } = await supabase
    .from('bookkeeping_funds')
    .insert({
      book_id: params.id,
      name: body.name.trim(),
      fund_type: body.fund_type,
      description: body.description?.trim() || null,
      sort_order: sortOrder,
      created_by: ctx.userId,
    })
    .select('id, book_id, name, fund_type, description, sort_order, archived, created_by, created_at')
    .single();

  if (error) {
    // Unique (book_id, name) violation → friendly message.
    if (error.code === '23505') return NextResponse.json({ error: 'A fund with that name already exists.' }, { status: 409 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ fund: { ...data, in_use: false } });
}
