import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase-server';
import { getBookkeepingContext } from '@/lib/bookkeeping/server';

const SELECT = `
  id, book_id, role, source_type, linked_client_id, name,
  profit_share_pct, shareholding_pct, shares_held, annual_salary,
  capital_account_id, effective_from, effective_to, created_at
`;

const PatchBody = z.object({
  role: z.enum(['partner', 'sole_trader', 'director', 'shareholder']).optional(),
  name: z.string().min(1).max(200).optional(),
  profit_share_pct: z.number().min(0).max(100).nullable().optional(),
  shareholding_pct: z.number().min(0).max(100).nullable().optional(),
  shares_held: z.number().min(0).nullable().optional(),
  annual_salary: z.number().min(0).nullable().optional(),
  capital_account_id: z.string().uuid().nullable().optional(),
  effective_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  effective_to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
}).refine(b => Object.keys(b).length > 0, { message: 'No fields to update' });

export async function PATCH(req: NextRequest, { params }: { params: { id: string; participantId: string } }) {
  const ctx = await getBookkeepingContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  let body: z.infer<typeof PatchBody>;
  try { body = PatchBody.parse(await req.json()); }
  catch (e) { return NextResponse.json({ error: 'Invalid payload', detail: String(e) }, { status: 400 }); }

  const supabase = createClient();
  const patch: Record<string, unknown> = {};
  for (const k of Object.keys(body) as (keyof typeof body)[]) {
    patch[k] = k === 'name' ? String(body[k]).trim() : body[k];
  }

  const { data, error } = await supabase
    .from('bookkeeping_book_participants')
    .update(patch)
    .eq('id', params.participantId)
    .eq('book_id', params.id)
    .eq('firm_id', ctx.firmId)
    .select(SELECT)
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ participant: data });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string; participantId: string } }) {
  const ctx = await getBookkeepingContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const supabase = createClient();
  const { error } = await supabase
    .from('bookkeeping_book_participants')
    .delete()
    .eq('id', params.participantId)
    .eq('book_id', params.id)
    .eq('firm_id', ctx.firmId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
