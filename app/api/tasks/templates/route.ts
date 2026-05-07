import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';

const CreateTemplateSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional().nullable(),
  is_firm_wide: z.boolean().optional(),
  category: z.string().optional(),
  recurrence_type: z.enum(['once', 'weekly', 'bi-weekly', 'monthly', 'quarterly', 'annually', 'custom']).optional().nullable(),
  recurrence_interval_days: z.number().int().positive().optional().nullable(),
  estimated_duration_days: z.number().int().positive().optional().nullable(),
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
});

// GET /api/tasks/templates
export async function GET(_req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const supabase = createClient();
  const { data: templates, error } = await supabase
    .from('task_templates')
    .select(`
      *,
      created_by_user:users!task_templates_created_by_fkey(id, full_name, email),
      steps:task_template_steps(*),
      edges:task_template_edges(*)
    `)
    .eq('firm_id', ctx.firmId)
    .order('name', { ascending: true });

  if (error) {
    console.error('GET /api/tasks/templates', error);
    return NextResponse.json({ error: 'Failed to load templates' }, { status: 500 });
  }

  return NextResponse.json({ templates: templates ?? [] });
}

// POST /api/tasks/templates
export async function POST(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const parsed = CreateTemplateSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' }, { status: 400 });

  const supabase = createClient();
  const { steps, edges, ...tplData } = parsed.data;

  const { data: template, error } = await supabase
    .from('task_templates')
    .insert({
      firm_id: ctx.firmId,
      created_by: ctx.userId,
      name: tplData.name,
      description: tplData.description ?? null,
      is_firm_wide: tplData.is_firm_wide ?? true,
      category: tplData.category ?? 'general',
      recurrence_type: tplData.recurrence_type ?? null,
      recurrence_interval_days: tplData.recurrence_interval_days ?? null,
      estimated_duration_days: tplData.estimated_duration_days ?? null,
    })
    .select()
    .single();

  if (error) {
    console.error('POST /api/tasks/templates', error);
    return NextResponse.json({ error: 'Failed to create template' }, { status: 500 });
  }

  if (steps && steps.length > 0) {
    const { error: stepsError } = await supabase.from('task_template_steps').insert(
      steps.map(s => ({
        template_id: template.id,
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
    if (stepsError) {
      console.error('POST /api/tasks/templates steps', stepsError);
      // Clean up the orphaned template header and surface the error
      await supabase.from('task_templates').delete().eq('id', template.id);
      return NextResponse.json(
        { error: `Failed to save template steps: ${stepsError.message}` },
        { status: 500 }
      );
    }
  }

  if (edges && edges.length > 0) {
    const { error: edgesError } = await supabase.from('task_template_edges').insert(
      edges.map(e => ({ template_id: template.id, from_step_key: e.from_step_key, to_step_key: e.to_step_key, label: e.label ?? null, condition_type: e.condition_type ?? null, condition_config: e.condition_config ?? null, source_handle: e.source_handle ?? null, target_handle: e.target_handle ?? null }))
    );
    if (edgesError) {
      console.error('POST /api/tasks/templates edges', edgesError);
      // Non-fatal — edges can be re-added, but log clearly
    }
  }

  return NextResponse.json({ template }, { status: 201 });
}
