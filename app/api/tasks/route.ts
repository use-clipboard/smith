import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';
import { notifyTaskStepAssignments } from '@/lib/notifications';
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

  // Strategy: fetch task headers (small, fast) in a single paginated pass,
  // then fetch related rows (steps / edges / client / creator) in *separate*
  // batched queries and merge client-side. This avoids the Postgres
  // statement-timeout that a single mega-join hits once a firm has > ~1k tasks.
  const PAGE_SIZE = 1000;

  const tasks: Record<string, unknown>[] = [];
  for (let page = 0; ; page++) {
    let q = supabase
      .from('tasks')
      .select('*')
      .eq('firm_id', ctx.firmId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
    if (status) q = q.eq('status', status);
    if (clientId) q = q.eq('client_id', clientId);
    if (search) q = q.ilike('title', `%${search}%`);
    const { data, error } = await q;
    if (error) {
      console.error('GET /api/tasks (headers)', error);
      return NextResponse.json({ error: 'Failed to load tasks' }, { status: 500 });
    }
    if (!data || data.length === 0) break;
    tasks.push(...data);
    if (data.length < PAGE_SIZE) break;
  }

  if (tasks.length > 0) {
    const taskIds = tasks.map(t => t.id as string);
    const clientIds = [...new Set(tasks.map(t => t.client_id).filter(Boolean) as string[])];
    const creatorIds = [...new Set(tasks.map(t => t.created_by).filter(Boolean) as string[])];

    // Fan out four lighter queries in parallel. Each one stays well within timeout.
    // BATCH must keep the request URL under the gateway's URL-length limit
    // (UUIDs are 36 chars + comma; ~100 ids per batch ≈ 3.7 KB which is safe).
    const BATCH = 100;
    async function fetchAllSteps() {
      const all: Record<string, unknown>[] = [];
      for (let i = 0; i < taskIds.length; i += BATCH) {
        const slice = taskIds.slice(i, i + BATCH);
        const { data, error } = await supabase
          .from('task_steps')
          .select('*, assignee:users(id, full_name, email)')
          .in('task_id', slice);
        if (error) console.error(`[GET /api/tasks] steps batch ${i} failed:`, error.message);
        if (data) all.push(...data);
      }
      return all;
    }
    async function fetchAllEdges() {
      const all: Record<string, unknown>[] = [];
      for (let i = 0; i < taskIds.length; i += BATCH) {
        const slice = taskIds.slice(i, i + BATCH);
        const { data, error } = await supabase.from('task_step_edges').select('*').in('task_id', slice);
        if (error) console.error(`[GET /api/tasks] edges batch ${i} failed:`, error.message);
        if (data) all.push(...data);
      }
      return all;
    }
    async function fetchClients() {
      const all: Record<string, unknown>[] = [];
      for (let i = 0; i < clientIds.length; i += BATCH) {
        const slice = clientIds.slice(i, i + BATCH);
        const { data, error } = await supabase
          .from('clients')
          .select('id, name, client_ref, contact_email, status')
          .in('id', slice);
        if (error) console.error(`[GET /api/tasks] clients batch ${i} failed:`, error.message);
        if (data) all.push(...data);
      }
      return all;
    }
    async function fetchCreators() {
      const all: Record<string, unknown>[] = [];
      for (let i = 0; i < creatorIds.length; i += BATCH) {
        const slice = creatorIds.slice(i, i + BATCH);
        const { data, error } = await supabase
          .from('users')
          .select('id, full_name, email')
          .in('id', slice);
        if (error) console.error(`[GET /api/tasks] creators batch ${i} failed:`, error.message);
        if (data) all.push(...data);
      }
      return all;
    }

    const [allSteps, allEdges, clientRows, creatorRows] = await Promise.all([
      fetchAllSteps(), fetchAllEdges(), fetchClients(), fetchCreators(),
    ]);

    const clientById = new Map(clientRows.map(c => [c.id as string, c]));
    const creatorById = new Map(creatorRows.map(u => [u.id as string, u]));
    const stepsByTask = new Map<string, Record<string, unknown>[]>();
    for (const s of allSteps) {
      const tid = s.task_id as string;
      const arr = stepsByTask.get(tid) ?? [];
      arr.push(s);
      stepsByTask.set(tid, arr);
    }
    const edgesByTask = new Map<string, Record<string, unknown>[]>();
    for (const e of allEdges) {
      const tid = e.task_id as string;
      const arr = edgesByTask.get(tid) ?? [];
      arr.push(e);
      edgesByTask.set(tid, arr);
    }

    for (const t of tasks) {
      const id = t.id as string;
      (t as { client?: unknown }).client = clientById.get((t.client_id as string) ?? '') ?? null;
      (t as { created_by_user?: unknown }).created_by_user = creatorById.get((t.created_by as string) ?? '') ?? null;
      (t as { steps?: unknown }).steps = stepsByTask.get(id) ?? [];
      (t as { edges?: unknown }).edges = edgesByTask.get(id) ?? [];
      // time_entries left omitted — TaskDetailPanel fetches them per task on open.
      (t as { time_entries?: unknown }).time_entries = [];
    }
  }

  // Filter by assignee after the fact (any step assigned to this user)
  // Using `any` here because tasks is built as Record<string,unknown>[] for typing flexibility above
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const filtered = assigneeId
    ? (tasks as any[]).filter((t: { steps?: { assignee_id: string | null }[] }) => t.steps?.some(s => s.assignee_id === assigneeId))
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
    // If this task is linked to a template, look up the matching template
    // step ids by step_key so we can stamp `template_step_id` on each row.
    // Without this every newly created task shows as "Customised" in the UI.
    let templateStepsByKey: Map<string, string> = new Map();
    if (taskData.template_id) {
      const { data: tplSteps } = await supabase
        .from('task_template_steps')
        .select('id, step_key')
        .eq('template_id', taskData.template_id);
      templateStepsByKey = new Map((tplSteps ?? []).map(r => [r.step_key as string, r.id as string]));
    }

    const { data: insertedSteps, error: stepsError } = await supabase.from('task_steps').insert(
      steps.map(s => ({
        task_id: task.id,
        template_step_id: templateStepsByKey.get(s.step_key) ?? null,
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

    // Notify assignees (fire-and-forget; don't block the response)
    notifyTaskStepAssignments({
      actorUserId: ctx.userId,
      firmId: ctx.firmId,
      taskId: task.id,
      taskTitle: task.title,
      assignments: steps.map(s => ({ assigneeId: s.assignee_id ?? null, stepTitle: s.title })),
    }).catch(err => console.error('Task assignment notification error', err));

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
