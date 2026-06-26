import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase-server';
import { getBookkeepingContext } from '@/lib/bookkeeping/server';

const SELECT = `
  id, book_id, role, source_type, linked_client_id, name,
  profit_share_pct, shareholding_pct, shares_held, annual_salary,
  capital_account_id, effective_from, effective_to, created_at
`;

const Body = z.object({
  role: z.enum(['partner', 'sole_trader', 'director', 'shareholder']),
  source_type: z.enum(['client_link', 'key_contact', 'manual']).default('manual'),
  linked_client_id: z.string().uuid().nullable().optional(),
  name: z.string().min(1).max(200),
  profit_share_pct: z.number().min(0).max(100).nullable().optional(),
  shareholding_pct: z.number().min(0).max(100).nullable().optional(),
  shares_held: z.number().min(0).nullable().optional(),
  annual_salary: z.number().min(0).nullable().optional(),
  capital_account_id: z.string().uuid().nullable().optional(),
  effective_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  effective_to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
});

async function loadBook(supabase: ReturnType<typeof createClient>, bookId: string, firmId: string) {
  const { data } = await supabase
    .from('bookkeeping_books').select('id, firm_id').eq('id', bookId).eq('firm_id', firmId).maybeSingle();
  return data;
}

// GET → participants for a book
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getBookkeepingContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const supabase = createClient();
  if (!(await loadBook(supabase, params.id, ctx.firmId))) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const { data, error } = await supabase
    .from('bookkeeping_book_participants')
    .select(SELECT)
    .eq('book_id', params.id)
    .order('role', { ascending: true })
    .order('created_at', { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ participants: data ?? [] });
}

// POST → add a participant
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getBookkeepingContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  let body: z.infer<typeof Body>;
  try { body = Body.parse(await req.json()); }
  catch (e) { return NextResponse.json({ error: 'Invalid payload', detail: String(e) }, { status: 400 }); }

  const supabase = createClient();
  const book = await loadBook(supabase, params.id, ctx.firmId);
  if (!book) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const { data, error } = await supabase
    .from('bookkeeping_book_participants')
    .insert({
      book_id: params.id,
      firm_id: ctx.firmId,
      role: body.role,
      source_type: body.source_type,
      linked_client_id: body.linked_client_id ?? null,
      name: body.name.trim(),
      profit_share_pct: body.profit_share_pct ?? null,
      shareholding_pct: body.shareholding_pct ?? null,
      shares_held: body.shares_held ?? null,
      annual_salary: body.annual_salary ?? null,
      capital_account_id: body.capital_account_id ?? null,
      effective_from: body.effective_from ?? null,
      effective_to: body.effective_to ?? null,
      created_by: ctx.userId,
    })
    .select(SELECT)
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ participant: data }, { status: 201 });
}
