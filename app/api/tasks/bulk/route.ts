import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient, createServiceClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';

const BulkRowSchema = z.object({
  template_id: z.string().uuid(),
  client_id: z.string().uuid().nullable(),
  deadline: z.string().nullable().optional(),
  step_assignees: z.record(z.string(), z.string()).optional().default({}),
});

const BulkSchema = z.object({
  rows: z.array(BulkRowSchema).min(1).max(1000),
  create_immediately: z.boolean().default(true),
});

// POST /api/tasks/bulk
export async function POST(req: NextRequest) {
  console.log('[bulk] handler called');
  try {
  const ctx = await getUserContext();
  console.log('[bulk] ctx:', ctx ? `userId=${ctx.userId} role=${ctx.userRole} firmId=${ctx.firmId}` : 'null');
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  // Admin only
  if (ctx.userRole !== 'admin') {
    return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
  }

  let body: unknown;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const parsed = BulkSchema.safeParse(body);
  if (!parsed.success) {
    console.error('[bulk] Zod validation failed:', parsed.error.issues);
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' }, { status: 400 });
  }

  const { rows, create_immediately } = parsed.data;
  console.log(`[bulk] ${rows.length} rows, create_immediately=${create_immediately}`);

  // Use anon client (RLS) for reading — ensures firm scoping on templates
  // Use service client for writes — bypasses RLS for admin bulk operations
  const supabaseRead  = createClient();
  const supabase      = createServiceClient();
  const status = create_immediately ? 'not_started' : 'draft';

  // Pre-load all unique templates referenced in rows
  const uniqueTemplateIds = [...new Set(rows.map(r => r.template_id))];
  console.log('[bulk] fetching templates:', uniqueTemplateIds);
  const { data: templates, error: tplError } = await supabaseRead
    .from('task_templates')
    .select('*, steps:task_template_steps(*), edges:task_template_edges(*)')
    .in('id', uniqueTemplateIds)
    .eq('firm_id', ctx.firmId);

  console.log('[bulk] templates found:', templates?.length ?? 0, tplError ? `error: ${tplError.message}` : '');

  if (tplError || !templates) {
    console.error('POST /api/tasks/bulk — template load error', tplError);
    return NextResponse.json({ error: `Failed to load templates: ${tplError?.message ?? 'no data'}` }, { status: 500 });
  }

  if (templates.length === 0) {
    return NextResponse.json({ error: 'No matching templates found for this firm. Check the template ID.' }, { status: 400 });
  }

  const templateMap = new Map(templates.map(t => [t.id, t]));

  // Process each row
  const results: { label: string; success: boolean; error?: string; task_id?: string }[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const template = templateMap.get(row.template_id);

    if (!template) {
      results.push({ label: `Row ${i + 1}`, success: false, error: 'Template not found' });
      continue;
    }

    // Build label for result display
    const label = template.name + (row.client_id ? '' : ' (no client)');

    try {
      // Create the task
      const { data: task, error: taskError } = await supabase
        .from('tasks')
        .insert({
          firm_id: ctx.firmId,
          created_by: ctx.userId,
          title: template.name,
          description: template.description ?? null,
          client_id: row.client_id ?? null,
          template_id: template.id,
          due_date: row.deadline ?? null,
          is_internal: !row.client_id,
          recurrence_type: template.recurrence_type ?? null,
          recurrence_interval_days: template.recurrence_interval_days ?? null,
          status,
        })
        .select('id')
        .single();

      if (taskError || !task) {
        console.error(`POST /api/tasks/bulk row ${i + 1} task insert error`, taskError);
        results.push({ label, success: false, error: taskError?.message ?? 'Insert failed' });
        continue;
      }

      // Build steps — apply step_assignees overrides on top of template defaults
      const steps = (template.steps ?? []) as Array<{
        step_key: string; title: string; description: string | null;
        assignee_role: string; default_assignee_id: string | null;
        tool_module_id: string | null; email_reminder_enabled: boolean;
        email_reminder_config: unknown; email_reminder_subject: string | null;
        email_reminder_message: string | null; client_instructions: string | null;
        client_can_upload: boolean; time_estimate_minutes: number | null;
        position_x: number; position_y: number;
        step_type: string | null; start_trigger_config: unknown; end_config: unknown;
      }>;

      if (steps.length > 0) {
        const stepAssignees = row.step_assignees ?? {};

        const { data: insertedSteps, error: stepsError } = await supabase
          .from('task_steps')
          .insert(steps.map(s => {
            // Resolve assignee: explicit override > template default
            let assigneeId: string | null = s.default_assignee_id ?? null;
            const override = stepAssignees[s.step_key];
            if (override === 'client') {
              assigneeId = null; // client step — no user assignee
            } else if (override && override !== '') {
              assigneeId = override;
            }

            const isClientStep = override === 'client'
              ? true
              : override && override !== ''
                ? false
                : s.assignee_role === 'client';

            return {
              task_id: task.id,
              step_key: s.step_key,
              title: s.title,
              description: s.description ?? null,
              assignee_id: isClientStep ? null : assigneeId,
              is_client_step: isClientStep,
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
              status: 'not_started',
            };
          }))
          .select('id, step_key, is_client_step');

        if (stepsError) console.error(`Bulk row ${i + 1} steps error`, stepsError);

        // Client portal tokens for client steps
        if (insertedSteps) {
          const clientSteps = insertedSteps.filter((s: { is_client_step: boolean }) => s.is_client_step);
          if (clientSteps.length > 0) {
            await supabase.from('task_client_tokens').insert(
              clientSteps.map((s: { id: string }) => ({
                task_id: task.id,
                step_id: s.id,
                firm_id: ctx.firmId,
              }))
            );
          }
        }
      }

      // Insert edges
      const edges = (template.edges ?? []) as Array<{
        from_step_key: string; to_step_key: string; label: string | null;
        condition_type: string | null; condition_config: unknown;
        source_handle: string | null; target_handle: string | null;
      }>;

      if (edges.length > 0) {
        await supabase.from('task_step_edges').insert(
          edges.map(e => ({
            task_id: task.id,
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

      results.push({ label, success: true, task_id: task.id });

    } catch (err) {
      results.push({ label, success: false, error: String(err) });
    }
  }

  const successCount = results.filter(r => r.success).length;
  return NextResponse.json({ results, successCount, totalCount: rows.length }, { status: 201 });

  } catch (err) {
    console.error('POST /api/tasks/bulk unhandled error', err);
    return NextResponse.json(
      { error: 'Internal server error', results: [], successCount: 0, totalCount: 0 },
      { status: 500 }
    );
  }
}
