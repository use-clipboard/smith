import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';
import { notifyTaskStepAssignments } from '@/lib/notifications';

const UpdateStepSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().optional().nullable(),
  assignee_id: z.string().uuid().optional().nullable(),
  is_client_step: z.boolean().optional(),
  status: z.enum(['not_started', 'in_progress', 'waiting_on_client', 'complete', 'skipped']).optional(),
  tool_module_id: z.string().optional().nullable(),
  tool_output_id: z.string().uuid().optional().nullable(),
  email_reminder_enabled: z.boolean().optional(),
  email_reminder_config: z.any().optional(),
  due_date: z.string().optional().nullable(),
  position_x: z.number().optional(),
  position_y: z.number().optional(),
});

// PUT /api/tasks/[id]/steps/[stepId]
export async function PUT(req: NextRequest, { params }: { params: { id: string; stepId: string } }) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const parsed = UpdateStepSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' }, { status: 400 });

  const supabase = createClient();

  // Fetch current step state so we can detect assignee changes and get the task title
  const { data: existingStep } = await supabase
    .from('task_steps')
    .select('assignee_id, title, task:tasks(id, title)')
    .eq('id', params.stepId)
    .eq('task_id', params.id)
    .single();

  const updates: Record<string, unknown> = { ...parsed.data, updated_at: new Date().toISOString() };
  if (parsed.data.status === 'complete') updates.completed_at = new Date().toISOString();

  const { data: step, error } = await supabase
    .from('task_steps')
    .update(updates)
    .eq('id', params.stepId)
    .eq('task_id', params.id)
    .select()
    .single();

  if (error) {
    console.error('PUT /api/tasks/[id]/steps/[stepId]', error);
    return NextResponse.json({ error: 'Failed to update step' }, { status: 500 });
  }

  // Notify if assignee was changed to a new (non-null) person
  const newAssigneeId = parsed.data.assignee_id;
  const oldAssigneeId = (existingStep?.assignee_id as string | null) ?? null;
  if (
    newAssigneeId &&
    newAssigneeId !== oldAssigneeId &&
    existingStep
  ) {
    const taskData = existingStep.task as unknown as { id: string; title: string } | null;
    if (taskData) {
      notifyTaskStepAssignments({
        actorUserId: ctx.userId,
        firmId: ctx.firmId,
        taskId: taskData.id,
        taskTitle: taskData.title,
        assignments: [{
          assigneeId: newAssigneeId,
          stepTitle: (existingStep.title as string) ?? parsed.data.title ?? '',
        }],
      }).catch(err => console.error('Step reassignment notification error', err));
    }
  }

  // Auto-update task status based on step statuses
  await syncTaskStatus(supabase, params.id, ctx.firmId);

  return NextResponse.json({ step });
}

// DELETE /api/tasks/[id]/steps/[stepId]
export async function DELETE(_req: NextRequest, { params }: { params: { id: string; stepId: string } }) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const supabase = createClient();
  const { error } = await supabase.from('task_steps').delete().eq('id', params.stepId).eq('task_id', params.id);
  if (error) return NextResponse.json({ error: 'Failed to delete step' }, { status: 500 });
  return NextResponse.json({ success: true });
}

// Derive task status from step statuses and update the task
async function syncTaskStatus(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  taskId: string,
  firmId: string
) {
  const { data: steps } = await supabase.from('task_steps').select('status').eq('task_id', taskId);
  if (!steps || steps.length === 0) return;

  const statuses: string[] = steps.map((s: { status: string }) => s.status);
  let taskStatus = 'not_started';

  if (statuses.every(s => s === 'complete' || s === 'skipped')) {
    taskStatus = 'complete';
  } else if (statuses.some(s => s === 'waiting_on_client')) {
    taskStatus = 'waiting_on_client';
  } else if (statuses.some(s => s === 'in_progress' || s === 'complete')) {
    taskStatus = 'in_progress';
  }

  const updates: Record<string, unknown> = { status: taskStatus, updated_at: new Date().toISOString() };
  if (taskStatus === 'complete') updates.completed_at = new Date().toISOString();

  await supabase.from('tasks').update(updates).eq('id', taskId).eq('firm_id', firmId);
}
