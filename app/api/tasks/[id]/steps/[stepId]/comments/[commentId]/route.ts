import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';

type Params = { params: { id: string; stepId: string; commentId: string } };

const PatchSchema = z.object({
  content: z.string().min(1).max(2000),
});

// PATCH /api/tasks/[id]/steps/[stepId]/comments/[commentId]
export async function PATCH(req: NextRequest, { params }: Params) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message }, { status: 400 });

  const supabase = createClient();

  // Only the owner can update (RLS enforces this too, but we check for a clear 403)
  const { data: existing, error: fetchErr } = await supabase
    .from('task_step_comments')
    .select('user_id')
    .eq('id', params.commentId)
    .eq('task_id', params.id)
    .eq('step_id', params.stepId)
    .single();

  if (fetchErr || !existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (existing.user_id !== ctx.userId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { data, error } = await supabase
    .from('task_step_comments')
    .update({ content: parsed.data.content })
    .eq('id', params.commentId)
    .select('id, content, created_at, user:users(id, full_name, email)')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ comment: data });
}

// DELETE /api/tasks/[id]/steps/[stepId]/comments/[commentId]
export async function DELETE(_req: NextRequest, { params }: Params) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const supabase = createClient();

  // Only the owner can delete (RLS enforces this too, but we check for a clear 403)
  const { data: existing, error: fetchErr } = await supabase
    .from('task_step_comments')
    .select('user_id')
    .eq('id', params.commentId)
    .eq('task_id', params.id)
    .eq('step_id', params.stepId)
    .single();

  if (fetchErr || !existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (existing.user_id !== ctx.userId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { error } = await supabase
    .from('task_step_comments')
    .delete()
    .eq('id', params.commentId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return new NextResponse(null, { status: 204 });
}
