import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';
import { createNotification, deleteTaskNotifications, filterTaskChangeRecipients } from '@/lib/notifications';
import { logTaskUpdate, logTaskDeleted } from '@/lib/taskAudit';
import { loadTaskTimeEntriesByTask } from '@/lib/tasks/taskTime';
import { spawnNextRecurrence } from '@/lib/tasks/recurrence';

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
      edges:task_step_edges(*)
    `)
    .eq('id', params.id)
    .eq('firm_id', ctx.firmId)
    .single();

  if (error || !task) return NextResponse.json({ error: 'Task not found' }, { status: 404 });

  // Time entries now live in the unified Timesheets ledger (with legacy fallback).
  const timeByTask = await loadTaskTimeEntriesByTask(supabase, [params.id]);
  (task as { time_entries?: unknown }).time_entries = timeByTask.get(params.id) ?? [];

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
    .select('id, status, recurrence_type, recurrence_interval_days, template_id, parent_task_id, client_id, title, description, due_date, is_internal, created_by')
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

  // Notify on status change: the step assignees (who are doing the work) AND the
  // task's creator/assigner — so whoever allocated the task hears when it's
  // actioned or completed, closing the "I assigned it but got no feedback" gap.
  // The actor never notifies themselves.
  if (parsed.data.status && parsed.data.status !== existing.status) {
    const statusLabel = formatStatusLabel(parsed.data.status);
    const isDone = parsed.data.status === 'complete';

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

    // Respect each recipient's task-change notification preference.
    const taskKind = {
      recurrence_type: existing.recurrence_type as string | null,
      template_id: existing.template_id as string | null,
      parent_task_id: (existing as { parent_task_id?: string | null }).parent_task_id ?? null,
    };
    const allowedAssignees = await filterTaskChangeRecipients(uniqueAssignees, taskKind);
    const notifyAssignees = uniqueAssignees.filter(id => allowedAssignees.has(id));

    if (notifyAssignees.length > 0) {
      await Promise.allSettled(
        notifyAssignees.map(userId =>
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

    // The creator/assigner — unless they made the change themselves or already
    // got a step-assignee ping (dedupe). Clicks through to the task.
    const creatorId = (existing.created_by as string | null) ?? null;
    const creatorAllowed = creatorId ? (await filterTaskChangeRecipients([creatorId], taskKind)).has(creatorId) : false;
    if (creatorId && creatorAllowed && creatorId !== ctx.userId && !uniqueAssignees.includes(creatorId)) {
      const { data: actor } = await supabase.from('users').select('full_name, email').eq('id', ctx.userId).single();
      const actorName = actor?.full_name || actor?.email || 'A team member';
      await createNotification({
        userId: creatorId,
        firmId: ctx.firmId,
        type: 'task_status_changed',
        title: `Task ${isDone ? 'completed' : 'updated'}: ${existing.title}`,
        body: isDone
          ? `${actorName} marked it complete — a task you assigned`
          : `${actorName} set it to ${statusLabel} — a task you assigned`,
        data: { task_id: params.id, task_link: '/tasks' },
      });
    }
  }

  // Handle recurrence: if completing a recurring task, spawn the next one.
  // spawnNextRecurrence re-checks recurrence_type and is idempotent per parent,
  // so it's safe even if the step-completion path already spawned the child.
  if (parsed.data.status === 'complete' && existing.status !== 'complete') {
    await spawnNextRecurrence(supabase, params.id, ctx.firmId, ctx.userId);
    // Task done → clear its "assigned to you" notifications for everyone.
    await deleteTaskNotifications(params.id);
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

  // Snapshot title/client for the audit row before we mark the task deleted.
  // Also grab service_id so the UI can offer to end the linked client Service.
  const { data: existing } = await supabase
    .from('tasks')
    .select('id, title, client_id, service_id')
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

  // If the deleted task was linked to a client Service, tell the UI (with the
  // service name + client) so it can ask whether to end that service too.
  let linkedService: { id: string; name: string; clientId: string } | null = null;
  const serviceId = (existing as { service_id?: string | null } | null)?.service_id ?? null;
  if (serviceId) {
    const { data: svc } = await supabase
      .from('client_services').select('id, name, client_id').eq('id', serviceId).single();
    if (svc) linkedService = { id: svc.id, name: svc.name, clientId: svc.client_id };
  }

  return NextResponse.json({ success: true, linkedService });
}
