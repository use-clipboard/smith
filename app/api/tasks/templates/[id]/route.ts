import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';

const UpdateTemplateSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional().nullable(),
  is_firm_wide: z.boolean().optional(),
  category: z.string().optional(),
  recurrence_type: z.enum(['once', 'weekly', 'bi-weekly', 'monthly', 'quarterly', 'annually', 'custom']).optional().nullable(),
  recurrence_interval_days: z.number().int().positive().optional().nullable(),
  estimated_duration_days: z.number().int().positive().optional().nullable(),
  // Full step/edge replacement
  steps: z.array(z.object({
    step_key: z.string(),
    title: z.string().min(1),
    description: z.string().optional().nullable(),
    assignee_role: z.enum(['team_member', 'client', 'any']).optional(),
    default_assignee_id: z.string().uuid().optional().nullable(),
    tool_module_id: z.string().optional().nullable(),
    email_reminder_enabled: z.boolean().optional(),
    email_reminder_config: z.any().optional(),
    email_reminder_subject: z.string().optional().nullable(),
    email_reminder_message: z.string().optional().nullable(),
    client_instructions: z.string().optional().nullable(),
    client_can_upload: z.boolean().optional(),
    time_estimate_minutes: z.number().int().positive().optional().nullable(),
    position_x: z.number().optional(),
    position_y: z.number().optional(),
    step_type: z.enum(['regular', 'start', 'end']).optional(),
    start_trigger_config: z.any().optional().nullable(),
    end_config: z.any().optional().nullable(),
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
  // When 'existing', merge the new step set into every active task linked to
  // this template. When 'new' (default), only future instantiations are affected.
  propagateTo: z.enum(['new', 'existing']).optional(),
});

// GET /api/tasks/templates/[id]
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const supabase = createClient();
  const { data: template, error } = await supabase
    .from('task_templates')
    .select(`*, created_by_user:users!task_templates_created_by_fkey(id, full_name, email), steps:task_template_steps(*), edges:task_template_edges(*)`)
    .eq('id', params.id)
    .eq('firm_id', ctx.firmId)
    .single();

  if (error || !template) return NextResponse.json({ error: 'Template not found' }, { status: 404 });
  return NextResponse.json({ template });
}

// PUT /api/tasks/templates/[id]
export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  if (ctx.userRole !== 'admin') return NextResponse.json({ error: 'Only admins can edit task templates.' }, { status: 403 });

  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const parsed = UpdateTemplateSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' }, { status: 400 });

  const supabase = createClient();

  const { steps, edges, propagateTo, ...tplData } = parsed.data;

  const { data: template, error } = await supabase
    .from('task_templates')
    .update({ ...tplData, updated_at: new Date().toISOString() })
    .eq('id', params.id)
    .eq('firm_id', ctx.firmId)
    .select()
    .single();

  if (error || !template) return NextResponse.json({ error: 'Failed to update template' }, { status: 500 });

  // Replace steps and edges entirely if provided
  if (steps !== undefined) {
    // Defensive: the UI occasionally produces duplicate step_keys (e.g. when
    // a step is duplicated in the builder). The unique constraint on
    // (template_id, step_key) would otherwise hard-fail the whole save and
    // leave the template with NO steps (because the delete above already ran).
    // Rewrite collisions with a numeric suffix so the insert always succeeds.
    const seenKeys = new Set<string>();
    const dedupedSteps = steps.map(s => {
      let key = s.step_key;
      let suffix = 2;
      while (seenKeys.has(key)) { key = `${s.step_key}_${suffix++}`; }
      seenKeys.add(key);
      if (key !== s.step_key) {
        console.warn(
          `PUT /api/tasks/templates/${params.id}: duplicate step_key "${s.step_key}" → renamed to "${key}"`
        );
      }
      return { ...s, step_key: key };
    });

    await supabase.from('task_template_steps').delete().eq('template_id', params.id);
    if (dedupedSteps.length > 0) {
      const { error: stepsInsertError } = await supabase.from('task_template_steps').insert(
        dedupedSteps.map(s => ({
          template_id: params.id,
          step_key: s.step_key,
          title: s.title,
          description: s.description ?? null,
          assignee_role: s.assignee_role ?? 'team_member',
          default_assignee_id: s.default_assignee_id ?? null,
          tool_module_id: s.tool_module_id ?? null,
          email_reminder_enabled: s.email_reminder_enabled ?? false,
          email_reminder_config: s.email_reminder_config ?? { recipients: [], timing: 'on_assign' },
          email_reminder_subject: s.email_reminder_subject ?? null,
          email_reminder_message: s.email_reminder_message ?? null,
          client_instructions: s.client_instructions ?? null,
          client_can_upload: s.client_can_upload ?? false,
          time_estimate_minutes: s.time_estimate_minutes ?? null,
          position_x: s.position_x ?? 200,
          position_y: s.position_y ?? 0,
          step_type: s.step_type ?? 'regular',
          start_trigger_config: s.start_trigger_config ?? null,
          end_config: s.end_config ?? null,
        }))
      );
      if (stepsInsertError) {
        console.error('PUT /api/tasks/templates/[id] steps', stepsInsertError);
        return NextResponse.json(
          { error: `Failed to save template steps: ${stepsInsertError.message}` },
          { status: 500 }
        );
      }
    }
  }

  if (edges !== undefined) {
    await supabase.from('task_template_edges').delete().eq('template_id', params.id);
    if (edges.length > 0) {
      await supabase.from('task_template_edges').insert(
        edges.map(e => ({ template_id: params.id, from_step_key: e.from_step_key, to_step_key: e.to_step_key, label: e.label ?? null, condition_type: e.condition_type ?? null, condition_config: e.condition_config ?? null, source_handle: e.source_handle ?? null, target_handle: e.target_handle ?? null }))
      );
    }
  }

  // ── Optional: propagate the new step set to existing active tasks ────────
  let propagation: { updatedTasks: number; addedSteps: number; updatedSteps: number } | null = null;
  if (propagateTo === 'existing' && steps !== undefined) {
    propagation = { updatedTasks: 0, addedSteps: 0, updatedSteps: 0 };

    // Re-load freshly-saved template steps (with their generated IDs)
    const { data: freshSteps } = await supabase
      .from('task_template_steps')
      .select('id, step_key, title, description, assignee_role, default_assignee_id, tool_module_id, email_reminder_enabled, email_reminder_config, email_reminder_subject, email_reminder_message, client_instructions, client_can_upload, time_estimate_minutes, position_x, position_y, step_type, start_trigger_config, end_config')
      .eq('template_id', params.id);
    const templateStepsById = new Map<string, NonNullable<typeof freshSteps>[number]>();
    const templateStepsByKey = new Map<string, NonNullable<typeof freshSteps>[number]>();
    for (const s of freshSteps ?? []) {
      templateStepsById.set(s.id, s);
      templateStepsByKey.set(s.step_key, s);
    }

    // Active task instances linked to this template
    const { data: activeTasks } = await supabase
      .from('tasks')
      .select('id')
      .eq('firm_id', ctx.firmId)
      .eq('template_id', params.id)
      .is('deleted_at', null)
      .not('status', 'in', '("complete","draft")');

    const taskIds = (activeTasks ?? []).map(t => t.id as string);

    if (taskIds.length > 0) {
      // Existing steps on every active task, batched to stay under URL length
      const BATCH = 100;
      const existingByTask = new Map<string, Array<{ id: string; step_key: string; template_step_id: string | null }>>();
      for (let i = 0; i < taskIds.length; i += BATCH) {
        const slice = taskIds.slice(i, i + BATCH);
        const { data: existing } = await supabase
          .from('task_steps')
          .select('id, task_id, step_key, template_step_id')
          .in('task_id', slice);
        for (const r of existing ?? []) {
          const arr = existingByTask.get(r.task_id) ?? [];
          arr.push({ id: r.id, step_key: r.step_key, template_step_id: r.template_step_id });
          existingByTask.set(r.task_id, arr);
        }
      }

      // For each task: update matching steps, add missing ones, never delete
      const insertRows: Array<Record<string, unknown>> = [];
      for (const taskId of taskIds) {
        const taskSteps = existingByTask.get(taskId) ?? [];
        const matchedTemplateStepIds = new Set<string>();

        for (const ts of taskSteps) {
          // Match by template_step_id first (most reliable), then fall back to step_key
          let tpl = ts.template_step_id ? templateStepsById.get(ts.template_step_id) : undefined;
          if (!tpl) tpl = templateStepsByKey.get(ts.step_key);
          if (!tpl) continue; // task has a custom step the template doesn't know about — leave alone
          matchedTemplateStepIds.add(tpl.id);
          await supabase.from('task_steps').update({
            title: tpl.title,
            description: tpl.description,
            tool_module_id: tpl.tool_module_id,
            email_reminder_enabled: tpl.email_reminder_enabled,
            email_reminder_config: tpl.email_reminder_config,
            email_reminder_subject: tpl.email_reminder_subject,
            email_reminder_message: tpl.email_reminder_message,
            client_instructions: tpl.client_instructions,
            client_can_upload: tpl.client_can_upload,
            template_step_id: tpl.id,
            updated_at: new Date().toISOString(),
          }).eq('id', ts.id);
          propagation.updatedSteps++;
        }

        // Any template step not matched yet → add it to this task
        const existingKeys = new Set(taskSteps.map(s => s.step_key));
        for (const tpl of (freshSteps ?? [])) {
          if (matchedTemplateStepIds.has(tpl.id)) continue;
          // Ensure unique key on this task
          let key = tpl.step_key;
          let suffix = 2;
          while (existingKeys.has(key)) { key = `${tpl.step_key}_${suffix++}`; }
          existingKeys.add(key);
          insertRows.push({
            task_id: taskId,
            template_step_id: tpl.id,
            step_key: key,
            title: tpl.title,
            description: tpl.description,
            assignee_id: tpl.default_assignee_id,
            is_client_step: tpl.assignee_role === 'client',
            tool_module_id: tpl.tool_module_id,
            email_reminder_enabled: tpl.email_reminder_enabled,
            email_reminder_config: tpl.email_reminder_config,
            email_reminder_subject: tpl.email_reminder_subject,
            email_reminder_message: tpl.email_reminder_message,
            client_instructions: tpl.client_instructions,
            client_can_upload: tpl.client_can_upload,
            position_x: tpl.position_x,
            position_y: tpl.position_y,
            step_type: tpl.step_type ?? 'regular',
            start_trigger_config: tpl.start_trigger_config,
            end_config: tpl.end_config,
            status: 'not_started',
          });
        }

        propagation.updatedTasks++;
      }

      if (insertRows.length > 0) {
        // Insert in chunks of 500 to avoid payload bloat
        for (let i = 0; i < insertRows.length; i += 500) {
          await supabase.from('task_steps').insert(insertRows.slice(i, i + 500));
        }
        propagation.addedSteps = insertRows.length;
      }
    }
  }

  return NextResponse.json({ template, propagation });
}

// DELETE /api/tasks/templates/[id]
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  if (ctx.userRole !== 'admin') return NextResponse.json({ error: 'Only admins can delete task templates.' }, { status: 403 });

  const supabase = createClient();
  const { error } = await supabase.from('task_templates').delete().eq('id', params.id).eq('firm_id', ctx.firmId);
  if (error) return NextResponse.json({ error: 'Failed to delete template' }, { status: 500 });
  return NextResponse.json({ success: true });
}
