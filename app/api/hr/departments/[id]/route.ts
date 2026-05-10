import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';

const PatchSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  parent_department_id: z.string().uuid().nullable().optional(),
  color: z.string().nullable().optional(),
  display_order: z.number().int().optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  if (ctx.userRole !== 'admin') return NextResponse.json({ error: 'Admin only' }, { status: 403 });

  let patch: z.infer<typeof PatchSchema>;
  try { patch = PatchSchema.parse(await req.json()); }
  catch (e) { return NextResponse.json({ error: 'Invalid payload', detail: String(e) }, { status: 400 }); }

  const supabase = createClient();
  const { data, error } = await supabase
    .from('hr_departments')
    .update(patch)
    .eq('id', params.id)
    .eq('firm_id', ctx.firmId)
    .select('*')
    .single();

  if (error) {
    console.error('[PATCH /api/hr/departments/:id]', error);
    return NextResponse.json({ error: 'Failed to update department' }, { status: 500 });
  }
  return NextResponse.json({ department: data });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  if (ctx.userRole !== 'admin') return NextResponse.json({ error: 'Admin only' }, { status: 403 });

  const supabase = createClient();
  // Setting affected users' department_id to NULL is handled by the FK on delete set null.
  const { error } = await supabase
    .from('hr_departments')
    .delete()
    .eq('id', params.id)
    .eq('firm_id', ctx.firmId);

  if (error) {
    console.error('[DELETE /api/hr/departments/:id]', error);
    return NextResponse.json({ error: 'Failed to delete department' }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
