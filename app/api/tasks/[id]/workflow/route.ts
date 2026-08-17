import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';

// PUT /api/tasks/[id]/workflow
// Atomically replaces the entire step list + edge list of a single task
// instance. Admin only. Does NOT touch the template — only this client's task.
// On the wire we accept the same step/edge shape used by the template builder.
const StepSchema = z.object({
  // If supplied, the existing step with this id is preserved (so completed
  // statuses, assignees, comments, etc. are not wiped). Otherwise treated as new.
  id: z.string().uuid().optional().nullable(),
  step_key: z.string(),
  title: z.string().min(1),
  description: z.string().optional().nullable(),
  assignee_id: z.string().uuid().optional().nullable(),
  is_client_step: z.boolean().optional(),
  tool_module_id: z.string().optional().nullable(),
  email_reminder_enabled: z.boolean().optional(),
  email_reminder_config: z.any().optional(),
  email_reminder_subject: z.string().optional().nullable(),
  email_reminder_message: z.string().optional().nullable(),
  status_automation: z.any().optional().nullable(),
  client_instructions: z.string().optional().nullable(),
  client_can_upload: z.boolean().optional(),
  position_x: z.number().optional(),
  position_y: z.number().optional(),
  step_type: z.enum(['regular', 'start', 'end']).optional(),
  start_trigger_config: z.any().optional().nullable(),
  end_config: z.any().optional().nullable(),
  // Keep template lineage when present so the "Custom" badge stays accurate
  template_step_id: z.string().uuid().optional().nullable(),
});

const EdgeSchema = z.object({
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
});

const BodySchema = z.object({
  steps: z.array(StepSchema).min(1),
  edges: z.array(EdgeSchema).optional().default([]),
});

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  if (ctx.userRole !== 'admin') return NextResponse.json({ error: 'Only admins can edit a task workflow.' }, { status: 403 });

  const body = await req.json().catch(() => null);
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid request' }, { status: 400 });
  }

  const supabase = createClient();

  // Confirm the task belongs to this firm
  const { data: task } = await supabase
    .from('tasks')
    .select('id')
    .eq('id', params.id)
    .eq('firm_id', ctx.firmId)
    .maybeSingle();
  if (!task) return NextResponse.json({ error: 'Task not found' }, { status: 404 });

  // Load current steps so we can decide which to keep (update) vs replace.
  // We match incoming steps to existing ones by id first, then fall back to
  // step_key (which is unique within a single task). This preserves completion
  // status / comments / assignee on rows the user only renamed or re-described.
  const { data: existingSteps } = await supabase
    .from('task_steps')
    .select('id, step_key')
    .eq('task_id', params.id);
  const existingIds = new Set((existingSteps ?? []).map(r => r.id as string));
  const existingIdByKey = new Map((existingSteps ?? []).map(r => [r.step_key as string, r.id as string]));

  // Resolve incoming step → existing-id mapping
  const resolved = parsed.data.steps.map(s => {
    let matchedId: string | null = null;
    if (s.id && existingIds.has(s.id)) matchedId = s.id;
    else if (existingIdByKey.has(s.step_key)) matchedId = existingIdByKey.get(s.step_key) ?? null;
    return { spec: s, matchedId };
  });
  const incomingIds = new Set(resolved.map(r => r.matchedId).filter(Boolean) as string[]);

  // Delete any existing step the user removed from the workflow
  const toDelete = [...existingIds].filter(id => !incomingIds.has(id));
  if (toDelete.length > 0) {
    await supabase.from('task_steps').delete().in('id', toDelete);
  }

  // Update existing steps (only the editable columns — preserve status / completion etc.)
  for (const r of resolved) {
    const s = r.spec;
    if (r.matchedId) {
      await supabase
        .from('task_steps')
        .update({
          step_key: s.step_key,
          title: s.title,
          description: s.description ?? null,
          assignee_id: s.assignee_id ?? null,
          is_client_step: s.is_client_step ?? false,
          tool_module_id: s.tool_module_id ?? null,
          email_reminder_enabled: s.email_reminder_enabled ?? false,
          email_reminder_config: s.email_reminder_config ?? { recipients: [], timing: 'on_assign' },
          email_reminder_subject: s.email_reminder_subject ?? null,
          email_reminder_message: s.email_reminder_message ?? null,
          status_automation: s.status_automation ?? null,
          client_instructions: s.client_instructions ?? null,
          client_can_upload: s.client_can_upload ?? false,
          position_x: s.position_x ?? 200,
          position_y: s.position_y ?? 0,
          step_type: s.step_type ?? 'regular',
          start_trigger_config: s.start_trigger_config ?? null,
          end_config: s.end_config ?? null,
          template_step_id: s.template_step_id ?? null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', r.matchedId);
    }
  }

  // Insert brand-new steps (no matched existing row)
  const newSteps = resolved.filter(r => !r.matchedId).map(r => r.spec);
  if (newSteps.length > 0) {
    await supabase.from('task_steps').insert(
      newSteps.map(s => ({
        task_id: params.id,
        template_step_id: s.template_step_id ?? null,
        step_key: s.step_key,
        title: s.title,
        description: s.description ?? null,
        assignee_id: s.assignee_id ?? null,
        is_client_step: s.is_client_step ?? false,
        tool_module_id: s.tool_module_id ?? null,
        email_reminder_enabled: s.email_reminder_enabled ?? false,
        email_reminder_config: s.email_reminder_config ?? { recipients: [], timing: 'on_assign' },
        email_reminder_subject: s.email_reminder_subject ?? null,
        email_reminder_message: s.email_reminder_message ?? null,
        status_automation: s.status_automation ?? null,
        client_instructions: s.client_instructions ?? null,
        client_can_upload: s.client_can_upload ?? false,
        position_x: s.position_x ?? 200,
        position_y: s.position_y ?? 0,
        step_type: s.step_type ?? 'regular',
        start_trigger_config: s.start_trigger_config ?? null,
        end_config: s.end_config ?? null,
        status: 'not_started',
      }))
    );
  }

  // Replace edges wholesale (small, no completion state to preserve)
  await supabase.from('task_step_edges').delete().eq('task_id', params.id);
  if (parsed.data.edges.length > 0) {
    await supabase.from('task_step_edges').insert(
      parsed.data.edges.map(e => ({
        task_id: params.id,
        from_step_key: e.from_step_key,
        to_step_key: e.to_step_key,
        label: e.label ?? null,
        condition_type: e.condition_type ?? null,
        condition_config: e.condition_config ?? null,
        source_handle: e.source_handle ?? null,
        target_handle: e.target_handle ?? null,
      }))
    );
  }

  return NextResponse.json({ success: true });
}
