import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase-server';
import { getCampaignsContext } from '@/lib/campaigns/guard';

// GET /api/campaigns/templates — the firm's saved templates.
export async function GET() {
  const ctx = await getCampaignsContext();
  if (!ctx) return NextResponse.json({ error: 'No access' }, { status: 403 });

  const supabase = createClient();
  const { data, error } = await supabase
    .from('campaign_templates').select('*').eq('firm_id', ctx.firmId).order('updated_at', { ascending: false });
  if (error) return NextResponse.json({ error: 'Failed to load templates' }, { status: 500 });
  return NextResponse.json({ templates: data ?? [] });
}

const CreateSchema = z.object({
  name: z.string().trim().min(1).max(200).default('Untitled template'),
  description: z.string().max(1000).optional().default(''),
  category: z.string().max(60).optional().default('general'),
  subject: z.string().max(300).optional().default(''),
  preview_text: z.string().max(300).optional().default(''),
  body_html: z.string().optional().default(''),
});

// POST /api/campaigns/templates — save a template.
export async function POST(req: NextRequest) {
  const ctx = await getCampaignsContext();
  if (!ctx) return NextResponse.json({ error: 'No access' }, { status: 403 });

  const parsed = CreateSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const supabase = createClient();
  const { data, error } = await supabase.from('campaign_templates').insert({
    firm_id: ctx.firmId,
    name: parsed.data.name,
    description: parsed.data.description,
    category: parsed.data.category,
    subject: parsed.data.subject,
    preview_text: parsed.data.preview_text,
    body_html: parsed.data.body_html,
    created_by: ctx.userId,
  }).select('*').single();

  if (error) return NextResponse.json({ error: 'Failed to save template' }, { status: 500 });
  return NextResponse.json({ template: data });
}
