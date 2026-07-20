import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase-server';
import { getCampaignsContext } from '@/lib/campaigns/guard';
import { resolveAudience, summarise, applyFrequencyGuard } from '@/lib/campaigns/audience';
import { getCampaignFirmSettings } from '@/lib/campaigns/settings';

export const maxDuration = 60;

const Schema = z.object({
  source: z.enum(['dynamic', 'static', 'manual', 'spreadsheet']).default('dynamic'),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  definition: z.record(z.string(), z.any()).optional(),
  member_client_ids: z.array(z.string().uuid()).optional(),
});

// POST /api/campaigns/audiences/preview — resolve an (unsaved) audience to a
// live recipient count + sample. Used by the builder as conditions change.
export async function POST(req: NextRequest) {
  const ctx = await getCampaignsContext();
  if (!ctx) return NextResponse.json({ error: 'No access' }, { status: 403 });

  const parsed = Schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const supabase = createClient();
  try {
    const recipients = await resolveAudience(supabase, ctx.firmId, {
      source: parsed.data.source,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      definition: parsed.data.definition as any,
      member_client_ids: parsed.data.member_client_ids,
    });
    // Reflect the firm's frequency guard so the preview count matches what a
    // send would actually do.
    const settings = await getCampaignFirmSettings(supabase, ctx.firmId);
    await applyFrequencyGuard(supabase, ctx.firmId, recipients, settings.frequency_guard_days);
    return NextResponse.json(summarise(recipients));
  } catch (err) {
    console.error('[campaigns/preview]', err);
    return NextResponse.json({ error: 'Failed to resolve audience' }, { status: 500 });
  }
}
