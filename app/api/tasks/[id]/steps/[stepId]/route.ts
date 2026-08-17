import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';
import { notifyTaskStepAssignments, createNotification, deleteTaskNotifications } from '@/lib/notifications';
import { spawnNextRecurrence } from '@/lib/tasks/recurrence';
import { syncStepReminders } from '@/lib/tasks/reminderProducer';

function formatStatusLabel(status: string): string {
  return status.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

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

  // Fetch current step state so we can detect assignee/status changes and get the task title
  const { data: existingStep } = await supabase
    .from('task_steps')
    .select('assignee_id, title, status, task:tasks(id, title)')
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

  // Notify step assignee when step status changes
  if (parsed.data.status && parsed.data.status !== ((existingStep?.status as string | null) ?? null) && existingStep) {
    // The effective assignee: use updated value if being changed, else existing
    const effectiveAssigneeId =
      parsed.data.assignee_id !== undefined
        ? parsed.data.assignee_id
        : ((existingStep.assignee_id as string | null) ?? null);

    if (effectiveAssigneeId && effectiveAssigneeId !== ctx.userId) {
      const taskData = existingStep.task as unknown as { id: string; title: string } | null;
      createNotification({
        userId: effectiveAssigneeId,
        firmId: ctx.firmId,
        type: 'task_status_changed',
        title: `Step updated: ${(existingStep.title as string) ?? ''}`,
        body: `Status changed to ${formatStatusLabel(parsed.data.status)}`,
        data: { task_id: taskData?.id ?? params.id, task_link: '/tasks' },
      }).catch(err => console.error('Step status notification error', err));
    }
  }

  // Auto-update task status based on step statuses
  await syncTaskStatus(supabase, params.id, ctx.firmId, ctx.userId);

  // Regenerate this step's email reminders — assignee, due date, config or
  // status may have changed. Non-blocking: a reminder hiccup must never fail
  // the step update.
  void syncStepReminders(supabase, params.stepId).catch(err => console.error('syncStepReminders', err));

  return NextResponse.json({ step });
}

// DELETE /api/tasks/[id]/steps/[stepId]
export async function DELETE(_req: NextRequest, { params }: { params: { id: string; stepId: string } }) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  if (ctx.userRole !== 'admin') return NextResponse.json({ error: 'Only admins can delete a step.' }, { status: 403 });

  const supabase = createClient();
  const { error } = await supabase.from('task_steps').delete().eq('id', params.stepId).eq('task_id', params.id);
  if (error) return NextResponse.json({ error: 'Failed to delete step' }, { status: 500 });
  return NextResponse.json({ success: true });
}

// Tell the task's creator/assigner that it was actioned/completed — so whoever
// allocated it hears back (closes the "assigned but no feedback" gap). No-op
// when the creator is the actor or unknown.
async function notifyTaskCreatorStatus(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  opts: { taskId: string; firmId: string; actorUserId: string | null; creatorId: string | null; title: string; status: string },
) {
  const { taskId, firmId, actorUserId, creatorId, title, status } = opts;
  if (!creatorId || creatorId === actorUserId) return;
  const isDone = status === 'complete';
  let actorName = 'A team member';
  if (actorUserId) {
    const { data: actor } = await supabase.from('users').select('full_name, email').eq('id', actorUserId).maybeSingle();
    actorName = actor?.full_name || actor?.email || 'A team member';
  }
  await createNotification({
    userId: creatorId,
    firmId,
    type: 'task_status_changed',
    title: `Task ${isDone ? 'completed' : 'updated'}: ${title}`,
    body: isDone
      ? `${actorName} marked it complete — a task you assigned`
      : `${actorName} set it to ${formatStatusLabel(status)} — a task you assigned`,
    data: { task_id: taskId, task_link: '/tasks' },
  }).catch((err: unknown) => console.error('Task creator notification error', err));
}

// Derive task status from step statuses and update the task
async function syncTaskStatus(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  taskId: string,
  firmId: string,
  actorUserId: string | null,
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

  const now = new Date().toISOString();

  if (taskStatus !== 'complete') {
    // Read the current row first so we only notify the creator on a REAL status
    // change (syncTaskStatus re-runs on every step tick).
    const { data: cur } = await supabase
      .from('tasks').select('status, created_by, title').eq('id', taskId).eq('firm_id', firmId).maybeSingle();
    await supabase.from('tasks').update({ status: taskStatus, updated_at: now }).eq('id', taskId).eq('firm_id', firmId);
    if (cur && cur.status !== taskStatus) {
      await notifyTaskCreatorStatus(supabase, {
        taskId, firmId, actorUserId, creatorId: cur.created_by ?? null, title: cur.title ?? 'Task', status: taskStatus,
      });
    }
    return;
  }

  // Transition INTO 'complete'. Do it as a single guarded update
  // (`.neq('status', 'complete')`) so that concurrent step ticks — e.g. the
  // "complete all" button firing every step at once — can't each flip the
  // task and spawn a duplicate next occurrence. Only the update that actually
  // performs the transition gets a row back; that one owns the recurrence.
  const { data: flipped } = await supabase
    .from('tasks')
    .update({ status: 'complete', completed_at: now, completed_by: actorUserId ?? null, updated_at: now })
    .eq('id', taskId)
    .eq('firm_id', firmId)
    .neq('status', 'complete')
    .select('id, recurrence_type, created_by, title')
    .maybeSingle();

  // No row back → the task was already complete (a concurrent tick won the
  // race, or this is a re-tick of a finished task). Nothing more to do.
  if (!flipped) return;

  // Task just completed by ticking its last step → clear its "assigned to you"
  // notifications for everyone (they've dealt with it).
  await deleteTaskNotifications(taskId);

  // …and tell whoever assigned it that it's done. (Runs only on the real
  // transition, so it fires exactly once.)
  await notifyTaskCreatorStatus(supabase, {
    taskId, firmId, actorUserId, creatorId: (flipped.created_by as string | null) ?? null, title: (flipped.title as string) ?? 'Task', status: 'complete',
  });

  // Recurring task just completed via the step path → roll forward. Previously
  // recurrence only fired from the task PUT route, so tasks finished by ticking
  // their last step never spawned the next occurrence. spawnNextRecurrence
  // re-checks recurrence_type and is idempotent per parent.
  if (flipped.recurrence_type && flipped.recurrence_type !== 'once') {
    await spawnNextRecurrence(supabase, taskId, firmId, actorUserId ?? '');
  }
}
