import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';
import { createNotification } from '@/lib/notifications';
import { logTaskUpdate, logTaskDeleted } from '@/lib/taskAudit';
import type { RecurrenceType } from '@/types';

function formatStatusLabel(status: string): string {
  return status.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

const UpdateTaskSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().optional().nullable(),
  client_id: z.string().uuid().optional().nullable(),
  status: z.enum(['not_started', 'in_progress', 'waiting_on_client', 'records_here', 'review', 'complete', 'draft']).optional(),
  due_date: z.string().optional().nullable(),
  is_internal: z.boolean().optional(),
  recurrence_type: z.enum(['once', 'weekly', 'bi-weekly', 'four-weekly', 'monthly', 'quarterly', 'annually', 'custom']).optional().nullable(),
  recurrence_interval_days: z.number().int().positive().optional().nullable(),
});

// GET /api/tasks/[id]
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const supabase = createClient();
  const { data: task, error } = await supabase
    .from('tasks')
    .select(`
      *,
      client:clients(id, name, client_ref, contact_email, status),
      created_by_user:users!tasks_created_by_fkey(id, full_name, email),
      steps:task_steps(*, assignee:users(id, full_name, email)),
      edges:task_step_edges(*),
      time_entries:task_time_entries(*, user:users(id, full_name, email))
    `)
    .eq('id', params.id)
    .eq('firm_id', ctx.firmId)
    .single();

  if (error || !task) return NextResponse.json({ error: 'Task not found' }, { status: 404 });
  return NextResponse.json({ task });
}

// PUT /api/tasks/[id]
export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const parsed = UpdateTaskSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' }, { status: 400 });

  const supabase = createClient();

  // Verify ownership and snapshot the fields we audit
  const { data: existing } = await supabase
    .from('tasks')
    .select('id, status, recurrence_type, recurrence_interval_days, template_id, client_id, title, description, due_date, is_internal')
    .eq('id', params.id)
    .eq('firm_id', ctx.firmId)
    .single();
  if (!existing) return NextResponse.json({ error: 'Task not found' }, { status: 404 });

  const updates: Record<string, unknown> = { ...parsed.data, updated_at: new Date().toISOString() };
  // Stamp completion metadata only on the transition INTO 'complete' so we
  // don't overwrite the original completer/timestamp if the task is edited
  // later while already in the completed state.
  if (parsed.data.status === 'complete' && existing.status !== 'complete') {
    updates.completed_at = new Date().toISOString();
    updates.completed_by = ctx.userId;
  }

  const { data: task, error } = await supabase.from('tasks').update(updates).eq('id', params.id).select().single();
  if (error) {
    console.error('PUT /api/tasks/[id]', error);
    return NextResponse.json({ error: 'Failed to update task' }, { status: 500 });
  }

  // Write audit rows for any tracked field that actually changed.
  // Don't await — failure to audit must never break the user's update.
  logTaskUpdate(
    supabase,
    {
      taskId:    params.id,
      firmId:    ctx.firmId,
      clientId:  (existing.client_id as string | null) ?? null,
      userId:    ctx.userId,
      taskTitle: (existing.title as string) ?? '',
    },
    existing as Record<string, unknown>,
    parsed.data as Record<string, unknown>,
  ).catch(err => console.error('logTaskUpdate failed', err));

  // Notify step assignees when task status changes
  if (parsed.data.status && parsed.data.status !== existing.status) {
    const { data: steps } = await supabase
      .from('task_steps')
      .select('assignee_id')
      .eq('task_id', params.id)
      .not('assignee_id', 'is', null);

    const uniqueAssignees = [
      ...new Set(
        (steps ?? [])
          .map((s: { assignee_id: string }) => s.assignee_id)
          .filter((id: string) => id !== ctx.userId)
      ),
    ] as string[];

    if (uniqueAssignees.length > 0) {
      const statusLabel = formatStatusLabel(parsed.data.status);
      await Promise.allSettled(
        uniqueAssignees.map(userId =>
          createNotification({
            userId,
            firmId: ctx.firmId,
            type: 'task_status_changed',
            title: `Task updated: ${existing.title}`,
            body: `Status changed to ${statusLabel}`,
            data: { task_id: params.id, task_link: '/tasks' },
          })
        )
      );
    }
  }

  // Handle recurrence: if completing a recurring task, spawn the next one
  if (parsed.data.status === 'complete' && existing.status !== 'complete') {
    const recType = (parsed.data.recurrence_type ?? existing.recurrence_type) as RecurrenceType | null;
    if (recType && recType !== 'once') {
      await spawnNextRecurrence(supabase, params.id, ctx.firmId, ctx.userId);
    }
  }

  return NextResponse.json({ task });
}

// DELETE /api/tasks/[id]
// Soft-delete: marks the task as deleted but preserves the row (and all
// associated steps, edges, time entries, comments) for the History view.
// To permanently purge a task, an admin-level SQL operation is required.
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const supabase = createClient();

  // Snapshot title/client for the audit row before we mark the task deleted
  const { data: existing } = await supabase
    .from('tasks')
    .select('id, title, client_id')
    .eq('id', params.id)
    .eq('firm_id', ctx.firmId)
    .single();

  const { error } = await supabase
    .from('tasks')
    .update({
      deleted_at: new Date().toISOString(),
      deleted_by: ctx.userId,
      updated_at: new Date().toISOString(),
    })
    .eq('id', params.id)
    .eq('firm_id', ctx.firmId)
    .is('deleted_at', null);
  if (error) {
    console.error('DELETE /api/tasks/[id]', error);
    return NextResponse.json({ error: 'Failed to delete task' }, { status: 500 });
  }

  if (existing) {
    logTaskDeleted(supabase, {
      taskId:    params.id,
      firmId:    ctx.firmId,
      clientId:  (existing.client_id as string | null) ?? null,
      userId:    ctx.userId,
      taskTitle: (existing.title as string) ?? '',
    }).catch(err => console.error('logTaskDeleted failed', err));
  }

  return NextResponse.json({ success: true });
}

// ── Recurrence helper ─────────────────────────────────────────────────────────

async function spawnNextRecurrence(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  completedTaskId: string,
  firmId: string,
  userId: string
) {
  const { data: completed } = await supabase
    .from('tasks')
    .select('*, steps:task_steps(*), edges:task_step_edges(*)')
    .eq('id', completedTaskId)
    .single();

  if (!completed) return;

  const nextDue = computeNextDueDate(completed.due_date, completed.recurrence_type, completed.recurrence_interval_days);

  const { data: newTask, error } = await supabase.from('tasks').insert({
    firm_id: firmId,
    client_id: completed.client_id,
    template_id: completed.template_id,
    created_by: userId,
    title: completed.title,
    description: completed.description,
    status: 'not_started',
    due_date: nextDue,
    is_internal: completed.is_internal,
    recurrence_type: completed.recurrence_type,
    recurrence_interval_days: completed.recurrence_interval_days,
    parent_task_id: completedTaskId,
  }).select().single();

  if (error || !newTask) { console.error('spawnNextRecurrence', error); return; }

  if (completed.steps?.length > 0) {
    await supabase.from('task_steps').insert(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      completed.steps.map((s: any) => ({
        task_id: newTask.id,
        // Carry template lineage forward so the "Custom" badge stays accurate
        template_step_id: s.template_step_id ?? null,
        step_key: s.step_key,
        title: s.title,
        description: s.description,
        assignee_id: s.assignee_id,
        is_client_step: s.is_client_step,
        tool_module_id: s.tool_module_id,
        email_reminder_enabled: s.email_reminder_enabled,
        email_reminder_config: s.email_reminder_config,
        position_x: s.position_x,
        position_y: s.position_y,
        status: 'not_started',
      }))
    );
  }

  if (completed.edges?.length > 0) {
    await supabase.from('task_step_edges').insert(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      completed.edges.map((e: any) => ({ task_id: newTask.id, from_step_key: e.from_step_key, to_step_key: e.to_step_key, label: e.label }))
    );
  }
}

function computeNextDueDate(currentDue: string | null, recType: string, intervalDays: number | null): string | null {
  const base = currentDue ? new Date(currentDue) : new Date();
  switch (recType) {
    case 'weekly':       base.setDate(base.getDate() + 7); break;
    case 'bi-weekly':    base.setDate(base.getDate() + 14); break;
    case 'four-weekly':  base.setDate(base.getDate() + 28); break;
    case 'monthly':      base.setMonth(base.getMonth() + 1); break;
    case 'quarterly':    base.setMonth(base.getMonth() + 3); break;
    case 'annually':     base.setFullYear(base.getFullYear() + 1); break;
    case 'custom':       base.setDate(base.getDate() + (intervalDays ?? 30)); break;
    default:             return null;
  }
  return base.toISOString().split('T')[0];
}
