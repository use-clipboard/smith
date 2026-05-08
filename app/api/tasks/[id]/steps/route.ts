import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';
import { notifyTaskStepAssignments } from '@/lib/notifications';

const CreateStepSchema = z.object({
  step_key: z.string().min(1),
  title: z.string().min(1),
  description: z.string().optional().nullable(),
  assignee_id: z.string().uuid().optional().nullable(),
  is_client_step: z.boolean().optional(),
  tool_module_id: z.string().optional().nullable(),
  email_reminder_enabled: z.boolean().optional(),
  email_reminder_config: z.any().optional(),
  due_date: z.string().optional().nullable(),
  position_x: z.number().optional(),
  position_y: z.number().optional(),
});

// GET /api/tasks/[id]/steps
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const supabase = createClient();
  const { data: steps, error } = await supabase
    .from('task_steps')
    .select('*, assignee:users(id, full_name, email)')
    .eq('task_id', params.id)
    .order('position_y', { ascending: true });

  if (error) return NextResponse.json({ error: 'Failed to load steps' }, { status: 500 });
  return NextResponse.json({ steps });
}

// POST /api/tasks/[id]/steps
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const parsed = CreateStepSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' }, { status: 400 });

  const supabase = createClient();

  // Verify task belongs to firm (also fetch title for notifications)
  const { data: task } = await supabase.from('tasks').select('id, title').eq('id', params.id).eq('firm_id', ctx.firmId).single();
  if (!task) return NextResponse.json({ error: 'Task not found' }, { status: 404 });

  const { data: step, error } = await supabase
    .from('task_steps')
    .insert({
      task_id: params.id,
      step_key: parsed.data.step_key,
      title: parsed.data.title,
      description: parsed.data.description ?? null,
      assignee_id: parsed.data.assignee_id ?? null,
      is_client_step: parsed.data.is_client_step ?? false,
      tool_module_id: parsed.data.tool_module_id ?? null,
      email_reminder_enabled: parsed.data.email_reminder_enabled ?? false,
      email_reminder_config: parsed.data.email_reminder_config ?? { recipients: [], timing: 'on_assign' },
      due_date: parsed.data.due_date ?? null,
      position_x: parsed.data.position_x ?? 200,
      position_y: parsed.data.position_y ?? 0,
      status: 'not_started',
    })
    .select()
    .single();

  if (error) {
    console.error('POST /api/tasks/[id]/steps', error);
    return NextResponse.json({ error: 'Failed to create step' }, { status: 500 });
  }

  // Notify assignee if one was set
  if (parsed.data.assignee_id) {
    notifyTaskStepAssignments({
      actorUserId: ctx.userId,
      firmId: ctx.firmId,
      taskId: params.id,
      taskTitle: (task as { id: string; title: string }).title,
      assignments: [{ assigneeId: parsed.data.assignee_id, stepTitle: parsed.data.title }],
    }).catch(err => console.error('Step assignment notification error', err));
  }

  return NextResponse.json({ step }, { status: 201 });
}
