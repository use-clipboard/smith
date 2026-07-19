import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase-server';
import { getCampaignsContext } from '@/lib/campaigns/guard';

// GET /api/campaigns/audiences — saved audiences for the firm.
export async function GET() {
  const ctx = await getCampaignsContext();
  if (!ctx) return NextResponse.json({ error: 'No access' }, { status: 403 });

  const supabase = createClient();
  const { data, error } = await supabase
    .from('campaign_audiences')
    .select('*')
    .eq('firm_id', ctx.firmId)
    .order('updated_at', { ascending: false });

  if (error) return NextResponse.json({ error: 'Failed to load audiences' }, { status: 500 });
  return NextResponse.json({ audiences: data ?? [] });
}

const AudienceSchema = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().max(1000).optional().default(''),
  source: z.enum(['dynamic', 'static', 'manual', 'spreadsheet']).default('dynamic'),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  definition: z.record(z.string(), z.any()).optional().default({}),
  member_client_ids: z.array(z.string().uuid()).optional().default([]),
});

// POST /api/campaigns/audiences — create a saved audience.
export async function POST(req: NextRequest) {
  const ctx = await getCampaignsContext();
  if (!ctx) return NextResponse.json({ error: 'No access' }, { status: 403 });

  const parsed = AudienceSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const supabase = createClient();
  const { data, error } = await supabase
    .from('campaign_audiences')
    .insert({
      firm_id: ctx.firmId,
      name: parsed.data.name,
      description: parsed.data.description,
      source: parsed.data.source,
      definition: parsed.data.definition,
      member_client_ids: parsed.data.member_client_ids,
      created_by: ctx.userId,
    })
    .select('*')
    .single();

  if (error) return NextResponse.json({ error: 'Failed to create audience' }, { status: 500 });
  return NextResponse.json({ audience: data });
}
