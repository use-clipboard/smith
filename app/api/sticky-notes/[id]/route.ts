import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';

const ColorEnum = z.enum(['yellow', 'pink', 'blue', 'green', 'purple', 'gray']);

const UpdateSchema = z.object({
  content:      z.unknown().optional(),
  position_x:   z.number().int().optional(),
  position_y:   z.number().int().optional(),
  width:        z.number().int().min(160).max(800).optional(),
  height:       z.number().int().min(120).max(800).optional(),
  color:        ColorEnum.optional(),
  z_order:      z.number().int().optional(),
  is_minimised: z.boolean().optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const parsed = UpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', issues: parsed.error.flatten() }, { status: 400 });
  }

  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const [k, v] of Object.entries(parsed.data)) {
    if (v !== undefined) update[k] = v;
  }

  const supabase = createClient();
  const { error } = await supabase
    .from('personal_sticky_notes')
    .update(update)
    .eq('id', params.id)
    .eq('user_id', ctx.userId);

  if (error) {
    console.error('PATCH /api/sticky-notes/[id]', error);
    return NextResponse.json({ error: 'Could not update sticky note' }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });

  const supabase = createClient();
  const { error } = await supabase
    .from('personal_sticky_notes')
    .delete()
    .eq('id', params.id)
    .eq('user_id', ctx.userId);

  if (error) {
    console.error('DELETE /api/sticky-notes/[id]', error);
    return NextResponse.json({ error: 'Could not delete sticky note' }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
