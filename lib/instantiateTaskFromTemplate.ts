// Server-side helper to spin up a new task from a task_templates row,
// cloning its steps + edges. Used by the proposals onboarding submission
// flow, and reusable from anywhere else that needs a one-shot instantiation.

import { createServiceClient } from '@/lib/supabase-server';

export interface InstantiateOptions {
  firmId: string;
  templateId: string;
  clientId: string | null;
  createdBy: string | null;
  /** Optional override for the task title. Defaults to the template's name. */
  titleOverride?: string;
}

export interface InstantiateResult {
  taskId: string | null;
  error?: string;
}

export async function instantiateTaskFromTemplate(opts: InstantiateOptions): Promise<InstantiateResult> {
  const service = createServiceClient();

  // Load template + steps + edges in one go.
  const { data: template, error: tplErr } = await service
    .from('task_templates')
    .select('*, steps:task_template_steps(*), edges:task_template_edges(*)')
    .eq('id', opts.templateId)
    .eq('firm_id', opts.firmId)
    .maybeSingle();
  if (tplErr) return { taskId: null, error: tplErr.message };
  if (!template) return { taskId: null, error: 'Template not found' };

  // Create the parent task
  const { data: task, error: taskErr } = await service
    .from('tasks')
    .insert({
      firm_id: opts.firmId,
      client_id: opts.clientId,
      created_by: opts.createdBy,
      template_id: template.id,
      title: opts.titleOverride ?? template.name,
      description: template.description ?? null,
      recurrence_type: template.recurrence_type ?? null,
      recurrence_interval_days: template.recurrence_interval_days ?? null,
      status: 'not_started',
    })
    .select('id')
    .single();
  if (taskErr || !task) return { taskId: null, error: taskErr?.message ?? 'Task insert failed' };

  // Clone steps
  const steps = (template.steps ?? []) as Array<Record<string, unknown>>;
  if (steps.length > 0) {
    const stepRows = steps.map(s => ({
      task_id: task.id,
      step_key: s.step_key as string,
      title: s.title as string,
      description: (s.description as string | null) ?? null,
      assignee_id: (s.default_assignee_id as string | null) ?? null,
      is_client_step: (s.assignee_role as string | null) === 'client',
      tool_module_id: (s.tool_module_id as string | null) ?? null,
      email_reminder_enabled: (s.email_reminder_enabled as boolean | undefined) ?? false,
      email_reminder_config: (s.email_reminder_config as unknown) ?? { recipients: [], timing: 'on_assign' },
      email_reminder_subject: (s.email_reminder_subject as string | null) ?? null,
      email_reminder_message: (s.email_reminder_message as string | null) ?? null,
      client_instructions: (s.client_instructions as string | null) ?? null,
      client_can_upload: (s.client_can_upload as boolean | undefined) ?? false,
      time_estimate_minutes: (s.time_estimate_minutes as number | null) ?? null,
      position_x: (s.position_x as number | undefined) ?? 200,
      position_y: (s.position_y as number | undefined) ?? 0,
      step_type: (s.step_type as string | null) ?? 'regular',
      start_trigger_config: (s.start_trigger_config as unknown) ?? null,
      end_config: (s.end_config as unknown) ?? null,
      status: 'not_started',
    }));
    const { error: stepsErr } = await service.from('task_steps').insert(stepRows);
    if (stepsErr) return { taskId: task.id, error: `Steps insert failed: ${stepsErr.message}` };
  }

  // Clone edges
  const edges = (template.edges ?? []) as Array<Record<string, unknown>>;
  if (edges.length > 0) {
    const edgeRows = edges.map(e => ({
      task_id: task.id,
      from_step_key: e.from_step_key as string,
      to_step_key: e.to_step_key as string,
      label: (e.label as string | null) ?? null,
      condition_type: (e.condition_type as string | null) ?? null,
      condition_config: (e.condition_config as unknown) ?? null,
      source_handle: (e.source_handle as string | null) ?? null,
      target_handle: (e.target_handle as string | null) ?? null,
    }));
    const { error: edgesErr } = await service.from('task_step_edges').insert(edgeRows);
    if (edgesErr) return { taskId: task.id, error: `Edges insert failed: ${edgesErr.message}` };
  }

  return { taskId: task.id };
}
