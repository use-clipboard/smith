import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase-server';
import { getCampaignsContext } from '@/lib/campaigns/guard';
import { getCampaignFirmSettings } from '@/lib/campaigns/settings';

// GET /api/campaigns/settings — firm campaign defaults + the caller's Gmail sender.
export async function GET() {
  const ctx = await getCampaignsContext();
  if (!ctx) return NextResponse.json({ error: 'No access' }, { status: 403 });

  const supabase = createClient();
  const [settings, { data: connection }] = await Promise.all([
    getCampaignFirmSettings(supabase, ctx.firmId),
    supabase.from('email_connections').select('google_email').eq('user_id', ctx.userId).maybeSingle(),
  ]);

  return NextResponse.json({
    settings,
    gmail: { connected: !!connection?.google_email, email: connection?.google_email ?? null },
  });
}

const PutSchema = z.object({
  reply_to: z.string().email().nullable().optional(),
  include_unsubscribe: z.boolean().optional(),
  unsubscribe_footer: z.string().max(500).optional(),
  default_dedupe: z.enum(['per_email', 'per_client']).optional(),
  frequency_guard_days: z.number().int().min(0).max(365).optional(),
});

// PUT /api/campaigns/settings — upsert the firm's campaign defaults.
export async function PUT(req: NextRequest) {
  const ctx = await getCampaignsContext();
  if (!ctx) return NextResponse.json({ error: 'No access' }, { status: 403 });

  const parsed = PutSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const supabase = createClient();
  const { error } = await supabase.from('campaign_settings').upsert({
    firm_id: ctx.firmId,
    ...parsed.data,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'firm_id' });

  if (error) return NextResponse.json({ error: 'Failed to save settings' }, { status: 500 });
  const settings = await getCampaignFirmSettings(supabase, ctx.firmId);
  return NextResponse.json({ settings });
}
