import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase-server';
import { getCampaignsContext } from '@/lib/campaigns/guard';

// GET /api/campaigns — list the firm's campaigns (newest first).
export async function GET() {
  const ctx = await getCampaignsContext();
  if (!ctx) return NextResponse.json({ error: 'No access' }, { status: 403 });

  const supabase = createClient();
  const { data, error } = await supabase
    .from('campaigns')
    .select('id, name, subject, status, send_mode, audience_id, scheduled_at, sent_at, stats, created_at, updated_at')
    .eq('firm_id', ctx.firmId)
    .order('created_at', { ascending: false });

  if (error) return NextResponse.json({ error: 'Failed to load campaigns' }, { status: 500 });
  return NextResponse.json({ campaigns: data ?? [] });
}

const CreateSchema = z.object({
  name: z.string().trim().min(1).max(200).default('Untitled campaign'),
  subject: z.string().max(300).optional(),
  preview_text: z.string().max(300).optional(),
  body_html: z.string().optional(),
  audience_id: z.string().uuid().nullable().optional(),
  from_email: z.string().email().nullable().optional(),
  reply_to: z.string().email().nullable().optional(),
});

// POST /api/campaigns — create a draft campaign.
export async function POST(req: NextRequest) {
  const ctx = await getCampaignsContext();
  if (!ctx) return NextResponse.json({ error: 'No access' }, { status: 403 });

  const parsed = CreateSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const supabase = createClient();
  const { data, error } = await supabase
    .from('campaigns')
    .insert({
      firm_id: ctx.firmId,
      name: parsed.data.name,
      subject: parsed.data.subject ?? '',
      preview_text: parsed.data.preview_text ?? '',
      body_html: parsed.data.body_html ?? '',
      audience_id: parsed.data.audience_id ?? null,
      from_email: parsed.data.from_email ?? null,
      reply_to: parsed.data.reply_to ?? null,
      created_by: ctx.userId,
    })
    .select('*')
    .single();

  if (error) return NextResponse.json({ error: 'Failed to create campaign' }, { status: 500 });
  return NextResponse.json({ campaign: data });
}
