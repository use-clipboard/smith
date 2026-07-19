import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase-server';
import { getCampaignsContext } from '@/lib/campaigns/guard';

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getCampaignsContext();
  if (!ctx) return NextResponse.json({ error: 'No access' }, { status: 403 });
  const supabase = createClient();
  const { data, error } = await supabase.from('campaign_templates').select('*').eq('id', params.id).eq('firm_id', ctx.firmId).maybeSingle();
  if (error) return NextResponse.json({ error: 'Failed to load template' }, { status: 500 });
  if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ template: data });
}

const PatchSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  description: z.string().max(1000).optional(),
  category: z.string().max(60).optional(),
  subject: z.string().max(300).optional(),
  preview_text: z.string().max(300).optional(),
  body_html: z.string().optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getCampaignsContext();
  if (!ctx) return NextResponse.json({ error: 'No access' }, { status: 403 });

  const parsed = PatchSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const supabase = createClient();
  const { data, error } = await supabase.from('campaign_templates')
    .update({ ...parsed.data, updated_at: new Date().toISOString() })
    .eq('id', params.id).eq('firm_id', ctx.firmId).select('*').single();
  if (error) return NextResponse.json({ error: 'Failed to update template' }, { status: 500 });
  return NextResponse.json({ template: data });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getCampaignsContext();
  if (!ctx) return NextResponse.json({ error: 'No access' }, { status: 403 });
  const supabase = createClient();
  const { error } = await supabase.from('campaign_templates').delete().eq('id', params.id).eq('firm_id', ctx.firmId);
  if (error) return NextResponse.json({ error: 'Failed to delete template' }, { status: 500 });
  return NextResponse.json({ ok: true });
}
