// Server-side helper to spin up a new task from a task_templates row,
// cloning its steps + edges. Used by the proposals onboarding submission
// flow, and reusable from anywhere else that needs a one-shot instantiation.

import { createServiceClient } from '@/lib/supabase-server';
import { autoCreateChDeadlineLink, type DeadlineType } from '@/lib/createChDeadlineLink';

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

  // CH-linked templates manage their own due date + cadence via the sync
  // engine — explicitly null out the manual recurrence fields here so we
  // don't end up with a CH-linked task that ALSO carries a stale manual
  // recurrence setting from the template row.
  const chDeadlineType = (template as { ch_deadline_type?: DeadlineType | null }).ch_deadline_type ?? null;
  const chOffsetDays   = (template as { ch_offset_days?: number | null }).ch_offset_days ?? 0;
  const isChLinkedTemplate = !!chDeadlineType;

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
      // due_date stays null on insert. For CH-linked tasks the link helper
      // populates it (when a cached deadline exists); for non-CH tasks the
      // caller is expected to set it through a separate path if needed.
      recurrence_type: isChLinkedTemplate ? null : (template.recurrence_type ?? null),
      recurrence_interval_days: isChLinkedTemplate ? null : (template.recurrence_interval_days ?? null),
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
      // Remember which template step this came from so future template edits
      // can match (and so the UI doesn't flag everything as "Custom")
      template_step_id: (s.id as string | null) ?? null,
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

  // CH-deadline auto-link via the shared helper. Failure is non-fatal —
  // the task itself is fine and the user can manually link later from the
  // CH Secretarial tool if they need to. When no cached CH deadline exists
  // yet (e.g. a newly-onboarded client whose CH data hasn't been fetched),
  // the link is still created with last_synced_deadline=null and the next
  // sync run fills the due date in.
  if (isChLinkedTemplate && opts.clientId) {
    await autoCreateChDeadlineLink(service, {
      firmId:   opts.firmId,
      taskId:   task.id,
      clientId: opts.clientId,
      template: { ch_deadline_type: chDeadlineType, ch_offset_days: chOffsetDays },
    });
  }

  return { taskId: task.id };
}
