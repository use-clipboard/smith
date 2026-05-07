import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';
import type { TaskStatus, RecurrenceType } from '@/types';

const CreateTaskSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  client_id: z.string().uuid().optional().nullable(),
  template_id: z.string().uuid().optional().nullable(),
  due_date: z.string().optional().nullable(),
  is_internal: z.boolean().optional(),
  recurrence_type: z.enum(['once', 'weekly', 'bi-weekly', 'monthly', 'quarterly', 'annually', 'custom']).optional().nullable(),
  recurrence_interval_days: z.number().int().positive().optional().nullable(),
  steps: z.array(z.object({
    step_key: z.string(),
    title: z.string().min(1),
    description: z.string().optional().nullable(),
    assignee_id: z.string().uuid().optional().nullable(),
    is_client_step: z.boolean().optional(),
    tool_module_id: z.string().optional().nullable(),
    email_reminder_enabled: z.boolean().optional(),
    email_reminder_config: z.any().optional(),
    client_instructions: z.string().optional().nullable(),
    client_can_upload: z.boolean().optional(),
    due_date: z.string().optional().nullable(),
    position_x: z.number().optional(),
    position_y: z.number().optional(),
  })).optional(),
  edges: z.array(z.object({
    from_step_key: z.string(),
    to_step_key: z.string(),
    label: z.string().optional().nullable(),
    condition_type: z.enum(['on_complete', 'timeout', 'always']).optional().nullable(),
    condition_config: z.object({
      timeout_days: z.number().optional(),
      timeout_hours: z.number().optional(),
    }).optional().nullable(),
    source_handle: z.string().optional().nullable(),
    target_handle: z.string().optional().nullable(),
  })).optional(),
});

// GET /api/tasks — list all tasks for the firm
export async function GET(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const supabase = createClient();
  const url = new URL(req.url);
  const status = url.searchParams.get('status') as TaskStatus | null;
  const clientId = url.searchParams.get('client_id');
  const assigneeId = url.searchParams.get('assignee_id');
  const search = url.searchParams.get('search') ?? '';

  let query = supabase
    .from('tasks')
    .select(`
      *,
      client:clients(id, name, client_ref, contact_email, status),
      created_by_user:users!tasks_created_by_fkey(id, full_name, email),
      steps:task_steps(*, assignee:users(id, full_name, email)),
      edges:task_step_edges(*),
      time_entries:task_time_entries(*)
    `)
    .eq('firm_id', ctx.firmId)
    .order('created_at', { ascending: false });

  if (status) query = query.eq('status', status);
  if (clientId) query = query.eq('client_id', clientId);
  if (search) query = query.ilike('title', `%${search}%`);

  const { data: tasks, error } = await query;
  if (error) {
    console.error('GET /api/tasks', error);
    return NextResponse.json({ error: 'Failed to load tasks' }, { status: 500 });
  }

  // Filter by assignee after the fact (any step assigned to this user)
  const filtered = assigneeId
    ? tasks?.filter(t => t.steps?.some((s: { assignee_id: string | null }) => s.assignee_id === assigneeId))
    : tasks;

  return NextResponse.json({ tasks: filtered ?? [] });
}

// POST /api/tasks — create a new task
export async function POST(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const parsed = CreateTaskSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' }, { status: 400 });

  const supabase = createClient();
  const { steps, edges, ...taskData } = parsed.data;

  const { data: task, error } = await supabase
    .from('tasks')
    .insert({
      firm_id: ctx.firmId,
      created_by: ctx.userId,
      title: taskData.title,
      description: taskData.description ?? null,
      client_id: taskData.client_id ?? null,
      template_id: taskData.template_id ?? null,
      due_date: taskData.due_date ?? null,
      is_internal: taskData.is_internal ?? !taskData.client_id,
      recurrence_type: (taskData.recurrence_type as RecurrenceType | null) ?? null,
      recurrence_interval_days: taskData.recurrence_interval_days ?? null,
      status: 'not_started',
    })
    .select()
    .single();

  if (error) {
    console.error('POST /api/tasks', error);
    return NextResponse.json({ error: 'Failed to create task' }, { status: 500 });
  }

  // Insert steps
  if (steps && steps.length > 0) {
    const { data: insertedSteps, error: stepsError } = await supabase.from('task_steps').insert(
      steps.map(s => ({
        task_id: task.id,
        step_key: s.step_key,
        title: s.title,
        description: s.description ?? null,
        assignee_id: s.assignee_id ?? null,
        is_client_step: s.is_client_step ?? false,
        tool_module_id: s.tool_module_id ?? null,
        email_reminder_enabled: s.email_reminder_enabled ?? false,
        email_reminder_config: s.email_reminder_config ?? { recipients: [], timing: 'on_assign' },
        client_instructions: s.client_instructions ?? null,
        client_can_upload: s.client_can_upload ?? false,
        due_date: s.due_date ?? null,
        position_x: s.position_x ?? 200,
        position_y: s.position_y ?? 0,
        status: 'not_started',
      }))
    ).select('id, step_key, is_client_step');
    if (stepsError) console.error('POST /api/tasks steps', stepsError);

    // Generate client portal tokens for every client step
    if (insertedSteps && insertedSteps.length > 0) {
      const clientSteps = insertedSteps.filter(s => s.is_client_step);
      if (clientSteps.length > 0) {
        const { error: tokenError } = await supabase.from('task_client_tokens').insert(
          clientSteps.map(s => ({
            task_id: task.id,
            step_id: s.id,
            firm_id: ctx.firmId,
            // token and expires_at use DB defaults (gen_random_bytes + now()+30 days)
          }))
        );
        if (tokenError) console.error('POST /api/tasks client tokens', tokenError);
      }
    }
  }

  // Insert edges
  if (edges && edges.length > 0) {
    const { error: edgesError } = await supabase.from('task_step_edges').insert(
      edges.map(e => ({ task_id: task.id, from_step_key: e.from_step_key, to_step_key: e.to_step_key, label: e.label ?? null, condition_type: e.condition_type ?? null, condition_config: e.condition_config ?? null, source_handle: e.source_handle ?? null, target_handle: e.target_handle ?? null }))
    );
    if (edgesError) console.error('POST /api/tasks edges', edgesError);
  }

  return NextResponse.json({ task }, { status: 201 });
}
