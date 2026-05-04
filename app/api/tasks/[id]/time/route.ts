import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';

const CreateTimeEntrySchema = z.object({
  step_id: z.string().uuid().optional().nullable(),
  started_at: z.string(),
  ended_at: z.string().optional().nullable(),
  duration_minutes: z.number().int().positive().optional().nullable(),
  notes: z.string().optional().nullable(),
});

// GET /api/tasks/[id]/time
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const supabase = createClient();
  const { data: entries, error } = await supabase
    .from('task_time_entries')
    .select('*, user:users(id, full_name, email), step:task_steps(id, step_key, title)')
    .eq('task_id', params.id)
    .order('started_at', { ascending: false });

  if (error) return NextResponse.json({ error: 'Failed to load time entries' }, { status: 500 });
  return NextResponse.json({ entries });
}

// POST /api/tasks/[id]/time
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const parsed = CreateTimeEntrySchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' }, { status: 400 });

  const supabase = createClient();

  // Verify task belongs to firm
  const { data: task } = await supabase.from('tasks').select('id').eq('id', params.id).eq('firm_id', ctx.firmId).single();
  if (!task) return NextResponse.json({ error: 'Task not found' }, { status: 404 });

  // Compute duration if both timestamps provided
  let durationMinutes = parsed.data.duration_minutes ?? null;
  if (!durationMinutes && parsed.data.started_at && parsed.data.ended_at) {
    const diff = new Date(parsed.data.ended_at).getTime() - new Date(parsed.data.started_at).getTime();
    durationMinutes = Math.round(diff / 60000);
  }

  const { data: entry, error } = await supabase
    .from('task_time_entries')
    .insert({
      task_id: params.id,
      step_id: parsed.data.step_id ?? null,
      user_id: ctx.userId,
      started_at: parsed.data.started_at,
      ended_at: parsed.data.ended_at ?? null,
      duration_minutes: durationMinutes,
      notes: parsed.data.notes ?? null,
    })
    .select()
    .single();

  if (error) {
    console.error('POST /api/tasks/[id]/time', error);
    return NextResponse.json({ error: 'Failed to log time' }, { status: 500 });
  }

  return NextResponse.json({ entry }, { status: 201 });
}
