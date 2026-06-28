import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase-server';
import { getBookkeepingContext } from '@/lib/bookkeeping/server';

type DB = ReturnType<typeof createClient>;

async function loadRecurring(supabase: DB, bookId: string, recurringId: string, firmId: string) {
  const { data } = await supabase
    .from('bookkeeping_recurring_transactions')
    .select('id, book_id, book:bookkeeping_books!inner(firm_id)')
    .eq('id', recurringId).eq('book_id', bookId)
    .maybeSingle();
  if (!data) return null;
  const book = (data as unknown as { book?: { firm_id?: string } }).book;
  return book?.firm_id === firmId ? data : null;
}

const PatchBody = z.object({
  name: z.string().min(1).max(200).optional(),
  frequency: z.enum(['weekly', 'monthly', 'quarterly', 'yearly']).optional(),
  interval_count: z.number().int().min(1).max(52).optional(),
  next_due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  active: z.boolean().optional(),
});

// ── PATCH — edit the schedule / pause-resume / rename ─────────────────────────
export async function PATCH(req: NextRequest, { params }: { params: { id: string; recurringId: string } }) {
  const ctx = await getBookkeepingContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  let body: z.infer<typeof PatchBody>;
  try { body = PatchBody.parse(await req.json()); }
  catch (e) { return NextResponse.json({ error: 'Invalid payload', detail: String(e) }, { status: 400 }); }

  const supabase = createClient();
  if (!await loadRecurring(supabase, params.id, params.recurringId, ctx.firmId)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (body.name !== undefined) patch.name = body.name.trim();
  if (body.frequency !== undefined) patch.frequency = body.frequency;
  if (body.interval_count !== undefined) patch.interval_count = body.interval_count;
  if (body.next_due_date !== undefined) patch.next_due_date = body.next_due_date;
  if (body.end_date !== undefined) patch.end_date = body.end_date;
  if (body.active !== undefined) patch.active = body.active;

  const { data, error } = await supabase
    .from('bookkeeping_recurring_transactions')
    .update(patch).eq('id', params.recurringId)
    .select('*').single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ recurring: data });
}

// ── DELETE ────────────────────────────────────────────────────────────────────
export async function DELETE(_req: NextRequest, { params }: { params: { id: string; recurringId: string } }) {
  const ctx = await getBookkeepingContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const supabase = createClient();
  if (!await loadRecurring(supabase, params.id, params.recurringId, ctx.firmId)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const { error } = await supabase
    .from('bookkeeping_recurring_transactions').delete().eq('id', params.recurringId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
