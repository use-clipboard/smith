import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase-server';
import { getCampaignsContext } from '@/lib/campaigns/guard';
import { computeNextRun } from '@/lib/campaigns/automations';

// GET /api/campaigns/automations — the firm's automations.
export async function GET() {
  const ctx = await getCampaignsContext();
  if (!ctx) return NextResponse.json({ error: 'No access' }, { status: 403 });

  const supabase = createClient();
  const { data, error } = await supabase
    .from('campaign_automations').select('*').eq('firm_id', ctx.firmId).order('updated_at', { ascending: false });
  if (error) return NextResponse.json({ error: 'Failed to load automations' }, { status: 500 });
  return NextResponse.json({ automations: data ?? [] });
}

const TriggerConfig = z.object({
  frequency: z.enum(['monthly', 'weekly']).optional(),
  day: z.number().int().min(1).max(31).optional(),
  hour: z.number().int().min(0).max(23).optional(),
  days: z.number().int().min(1).max(365).optional(),
}).default({});

const CreateSchema = z.object({
  name: z.string().trim().min(1).max(200).default('Untitled automation'),
  trigger_type: z.enum(['recurring', 'year_end_approaching', 'cs_approaching', 'invoice_overdue', 'mtd_quarter_outstanding', 'task_overdue']).default('recurring'),
  trigger_config: TriggerConfig,
  audience_id: z.string().uuid().nullable().optional(),
  subject: z.string().max(300).optional().default(''),
  preview_text: z.string().max(300).optional().default(''),
  body_html: z.string().optional().default(''),
  from_email: z.string().email().nullable().optional(),
});

// POST /api/campaigns/automations — create an automation (paused).
export async function POST(req: NextRequest) {
  const ctx = await getCampaignsContext();
  if (!ctx) return NextResponse.json({ error: 'No access' }, { status: 403 });

  const parsed = CreateSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const nextRun = parsed.data.trigger_type === 'recurring'
    ? computeNextRun(parsed.data.trigger_config, new Date()).toISOString()
    : null;

  const supabase = createClient();
  const { data, error } = await supabase.from('campaign_automations').insert({
    firm_id: ctx.firmId,
    name: parsed.data.name,
    trigger_type: parsed.data.trigger_type,
    trigger_config: parsed.data.trigger_config,
    audience_id: parsed.data.audience_id ?? null,
    subject: parsed.data.subject,
    preview_text: parsed.data.preview_text,
    body_html: parsed.data.body_html,
    from_email: parsed.data.from_email ?? null,
    next_run_at: nextRun,
    created_by: ctx.userId,
  }).select('*').single();

  if (error) return NextResponse.json({ error: 'Failed to create automation' }, { status: 500 });
  return NextResponse.json({ automation: data });
}
