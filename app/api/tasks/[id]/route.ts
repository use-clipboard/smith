import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';
import type { RecurrenceType } from '@/types';

const UpdateTaskSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().optional().nullable(),
  client_id: z.string().uuid().optional().nullable(),
  status: z.enum(['not_started', 'in_progress', 'waiting_on_client', 'records_here', 'review', 'complete', 'draft']).optional(),
  due_date: z.string().optional().nullable(),
  is_internal: z.boolean().optional(),
  recurrence_type: z.enum(['once', 'weekly', 'bi-weekly', 'monthly', 'quarterly', 'annually', 'custom']).optional().nullable(),
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
      client:clients(id, name, client_ref, contact_email),
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

  // Verify ownership
  const { data: existing } = await supabase.from('tasks').select('id, status, recurrence_type, recurrence_interval_days, template_id, client_id, title').eq('id', params.id).eq('firm_id', ctx.firmId).single();
  if (!existing) return NextResponse.json({ error: 'Task not found' }, { status: 404 });

  const updates: Record<string, unknown> = { ...parsed.data, updated_at: new Date().toISOString() };
  if (parsed.data.status === 'complete') updates.completed_at = new Date().toISOString();

  const { data: task, error } = await supabase.from('tasks').update(updates).eq('id', params.id).select().single();
  if (error) {
    console.error('PUT /api/tasks/[id]', error);
    return NextResponse.json({ error: 'Failed to update task' }, { status: 500 });
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
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const supabase = createClient();
  const { error } = await supabase.from('tasks').delete().eq('id', params.id).eq('firm_id', ctx.firmId);
  if (error) {
    console.error('DELETE /api/tasks/[id]', error);
    return NextResponse.json({ error: 'Failed to delete task' }, { status: 500 });
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
    case 'monthly':      base.setMonth(base.getMonth() + 1); break;
    case 'quarterly':    base.setMonth(base.getMonth() + 3); break;
    case 'annually':     base.setFullYear(base.getFullYear() + 1); break;
    case 'custom':       base.setDate(base.getDate() + (intervalDays ?? 30)); break;
    default:             return null;
  }
  return base.toISOString().split('T')[0];
}
