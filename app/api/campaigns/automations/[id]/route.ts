import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase-server';
import { getCampaignsContext } from '@/lib/campaigns/guard';
import { computeNextRun } from '@/lib/campaigns/automations';
import type { AutomationTriggerConfig } from '@/types/campaigns';

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getCampaignsContext();
  if (!ctx) return NextResponse.json({ error: 'No access' }, { status: 403 });
  const supabase = createClient();
  const { data, error } = await supabase.from('campaign_automations').select('*').eq('id', params.id).eq('firm_id', ctx.firmId).maybeSingle();
  if (error) return NextResponse.json({ error: 'Failed to load automation' }, { status: 500 });
  if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ automation: data });
}

const PatchSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  status: z.enum(['active', 'paused']).optional(),
  mode: z.enum(['single', 'journey']).optional(),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  steps: z.array(z.record(z.string(), z.any())).optional(),
  trigger_type: z.enum(['recurring', 'year_end_approaching', 'cs_approaching', 'invoice_overdue', 'mtd_quarter_outstanding', 'task_overdue']).optional(),
  trigger_config: z.object({
    frequency: z.enum(['monthly', 'weekly']).optional(),
    day: z.number().int().min(1).max(31).optional(),
    hour: z.number().int().min(0).max(23).optional(),
    days: z.number().int().min(1).max(365).optional(),
  }).optional(),
  audience_id: z.string().uuid().nullable().optional(),
  subject: z.string().max(300).optional(),
  preview_text: z.string().max(300).optional(),
  body_html: z.string().optional(),
  from_email: z.string().email().nullable().optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getCampaignsContext();
  if (!ctx) return NextResponse.json({ error: 'No access' }, { status: 403 });

  const parsed = PatchSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const supabase = createClient();
  const { data: existing } = await supabase.from('campaign_automations').select('trigger_type, trigger_config, next_run_at').eq('id', params.id).eq('firm_id', ctx.firmId).maybeSingle();
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const patch: Record<string, unknown> = { ...parsed.data, updated_at: new Date().toISOString() };

  // Recompute next_run_at when the schedule or trigger type changes to recurring.
  const triggerType = parsed.data.trigger_type ?? existing.trigger_type;
  const scheduleChanged = parsed.data.trigger_config !== undefined || parsed.data.trigger_type !== undefined;
  if (triggerType === 'recurring' && scheduleChanged) {
    const cfg = (parsed.data.trigger_config ?? existing.trigger_config ?? {}) as AutomationTriggerConfig;
    patch.next_run_at = computeNextRun(cfg, new Date()).toISOString();
  } else if (triggerType !== 'recurring' && parsed.data.trigger_type !== undefined) {
    patch.next_run_at = null;
  }

  const { data, error } = await supabase.from('campaign_automations').update(patch).eq('id', params.id).eq('firm_id', ctx.firmId).select('*').single();
  if (error) return NextResponse.json({ error: 'Failed to update automation' }, { status: 500 });
  return NextResponse.json({ automation: data });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getCampaignsContext();
  if (!ctx) return NextResponse.json({ error: 'No access' }, { status: 403 });
  const supabase = createClient();
  const { error } = await supabase.from('campaign_automations').delete().eq('id', params.id).eq('firm_id', ctx.firmId);
  if (error) return NextResponse.json({ error: 'Failed to delete automation' }, { status: 500 });
  return NextResponse.json({ ok: true });
}
