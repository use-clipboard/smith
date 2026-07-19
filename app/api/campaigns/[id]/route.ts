import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase-server';
import { getCampaignsContext } from '@/lib/campaigns/guard';

// GET /api/campaigns/[id] — one campaign, with its recipient rows.
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getCampaignsContext();
  if (!ctx) return NextResponse.json({ error: 'No access' }, { status: 403 });

  const supabase = createClient();
  const { data: campaign, error } = await supabase
    .from('campaigns')
    .select('*')
    .eq('id', params.id)
    .eq('firm_id', ctx.firmId)
    .maybeSingle();

  if (error) return NextResponse.json({ error: 'Failed to load campaign' }, { status: 500 });
  if (!campaign) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const { data: recipients } = await supabase
    .from('campaign_recipients')
    .select('id, client_id, email, name, status, opened_at, first_clicked_at, open_count, click_count, bounced_at, unsubscribed_at, error, sent_at')
    .eq('campaign_id', params.id)
    .order('name', { ascending: true });

  return NextResponse.json({ campaign, recipients: recipients ?? [] });
}

const PatchSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  subject: z.string().max(300).optional(),
  preview_text: z.string().max(300).optional(),
  body_html: z.string().optional(),
  body_font: z.string().nullable().optional(),
  from_email: z.string().email().nullable().optional(),
  reply_to: z.string().email().nullable().optional(),
  audience_id: z.string().uuid().nullable().optional(),
  status: z.enum([
    'draft', 'awaiting_review', 'changes_requested', 'approved',
    'scheduled', 'paused', 'cancelled',
  ]).optional(),
  scheduled_at: z.string().datetime().nullable().optional(),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  settings: z.record(z.string(), z.any()).optional(),
});

// PATCH /api/campaigns/[id] — update draft fields / status.
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getCampaignsContext();
  if (!ctx) return NextResponse.json({ error: 'No access' }, { status: 403 });

  const parsed = PatchSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const supabase = createClient();
  // Guard against editing a campaign mid-flight.
  const { data: existing } = await supabase
    .from('campaigns').select('status').eq('id', params.id).eq('firm_id', ctx.firmId).maybeSingle();
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (existing.status === 'sending' || existing.status === 'sent') {
    return NextResponse.json({ error: 'A sent or in-progress campaign cannot be edited.' }, { status: 409 });
  }

  const { data, error } = await supabase
    .from('campaigns')
    .update({ ...parsed.data, updated_at: new Date().toISOString() })
    .eq('id', params.id)
    .eq('firm_id', ctx.firmId)
    .select('*')
    .single();

  if (error) return NextResponse.json({ error: 'Failed to update campaign' }, { status: 500 });
  return NextResponse.json({ campaign: data });
}

// DELETE /api/campaigns/[id] — remove a campaign (and its recipients/events via cascade).
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getCampaignsContext();
  if (!ctx) return NextResponse.json({ error: 'No access' }, { status: 403 });

  const supabase = createClient();
  const { error } = await supabase
    .from('campaigns')
    .delete()
    .eq('id', params.id)
    .eq('firm_id', ctx.firmId);

  if (error) return NextResponse.json({ error: 'Failed to delete campaign' }, { status: 500 });
  return NextResponse.json({ ok: true });
}
