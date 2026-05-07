import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';

// GET /api/tasks/[id]/steps/[stepId]/comments
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string; stepId: string } },
) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const supabase = createClient();

  const { data, error } = await supabase
    .from('task_step_comments')
    .select(`
      id,
      content,
      created_at,
      user:users(id, full_name, email)
    `)
    .eq('task_id', params.id)
    .eq('step_id', params.stepId)
    .order('created_at', { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ comments: data ?? [] });
}

const PostSchema = z.object({
  content: z.string().min(1).max(2000),
});

// POST /api/tasks/[id]/steps/[stepId]/comments
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string; stepId: string } },
) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const parsed = PostSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message }, { status: 400 });

  const supabase = createClient();

  const { data, error } = await supabase
    .from('task_step_comments')
    .insert({
      task_id:  params.id,
      step_id:  params.stepId,
      user_id:  ctx.userId,
      content:  parsed.data.content,
    })
    .select(`id, content, created_at, user:users(id, full_name, email)`)
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ comment: data }, { status: 201 });
}
