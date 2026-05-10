import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';

const Patch = z.object({
  rating: z.enum(['exceeds', 'meets', 'developing', 'below']).nullable().optional(),
  achievements: z.string().nullable().optional(),
  development_areas: z.string().nullable().optional(),
  goals: z.string().nullable().optional(),
  staff_comments: z.string().nullable().optional(),
  status: z.enum(['draft', 'submitted', 'acknowledged']).optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  let patch: z.infer<typeof Patch>;
  try { patch = Patch.parse(await req.json()); }
  catch (e) { return NextResponse.json({ error: 'Invalid payload', detail: String(e) }, { status: 400 }); }

  const supabase = createClient();
  // Look up to enforce: only reviewer/admin can change status to 'submitted'
  // and only the subject can move to 'acknowledged'.
  const { data: existing } = await supabase
    .from('hr_appraisals')
    .select('user_id, reviewer_id, status')
    .eq('id', params.id)
    .maybeSingle();
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const update: Record<string, unknown> = { ...patch, updated_at: new Date().toISOString() };
  if (patch.status === 'submitted') {
    if (existing.reviewer_id !== ctx.userId && ctx.userRole !== 'admin') {
      return NextResponse.json({ error: 'Only the reviewer or an admin can submit.' }, { status: 403 });
    }
    update.submitted_at = new Date().toISOString();
  }
  if (patch.status === 'acknowledged') {
    if (existing.user_id !== ctx.userId) {
      return NextResponse.json({ error: 'Only the subject can acknowledge.' }, { status: 403 });
    }
    update.acknowledged_at = new Date().toISOString();
  }

  const { error } = await supabase.from('hr_appraisals').update(update).eq('id', params.id).eq('firm_id', ctx.firmId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  if (ctx.userRole !== 'admin') return NextResponse.json({ error: 'Admin only' }, { status: 403 });
  const supabase = createClient();
  const { error } = await supabase.from('hr_appraisals').delete().eq('id', params.id).eq('firm_id', ctx.firmId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
