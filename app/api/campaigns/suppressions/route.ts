import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase-server';
import { getCampaignsContext } from '@/lib/campaigns/guard';

// The firm's unsubscribe / do-not-market suppression list.

// GET /api/campaigns/suppressions
export async function GET() {
  const ctx = await getCampaignsContext();
  if (!ctx) return NextResponse.json({ error: 'No access' }, { status: 403 });

  const supabase = createClient();
  const { data, error } = await supabase
    .from('campaign_unsubscribes')
    .select('id, email, client_id, scope, created_at')
    .eq('firm_id', ctx.firmId)
    .order('created_at', { ascending: false });

  if (error) return NextResponse.json({ error: 'Failed to load suppression list' }, { status: 500 });
  return NextResponse.json({ suppressions: data ?? [] });
}

const AddSchema = z.object({
  email: z.string().email(),
  scope: z.enum(['marketing', 'all']).optional().default('marketing'),
});

// POST /api/campaigns/suppressions — manually add an address.
export async function POST(req: NextRequest) {
  const ctx = await getCampaignsContext();
  if (!ctx) return NextResponse.json({ error: 'No access' }, { status: 403 });

  const parsed = AddSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const supabase = createClient();
  const { error } = await supabase.from('campaign_unsubscribes').upsert({
    firm_id: ctx.firmId,
    email: parsed.data.email.trim().toLowerCase(),
    scope: parsed.data.scope,
  }, { onConflict: 'firm_id,email' });

  if (error) return NextResponse.json({ error: 'Failed to add address' }, { status: 500 });
  return NextResponse.json({ ok: true });
}

// DELETE /api/campaigns/suppressions?email=… (re-subscribe an address)
export async function DELETE(req: NextRequest) {
  const ctx = await getCampaignsContext();
  if (!ctx) return NextResponse.json({ error: 'No access' }, { status: 403 });

  const email = new URL(req.url).searchParams.get('email');
  if (!email) return NextResponse.json({ error: 'email required' }, { status: 400 });

  const supabase = createClient();
  const { error } = await supabase
    .from('campaign_unsubscribes')
    .delete()
    .eq('firm_id', ctx.firmId)
    .eq('email', email.trim().toLowerCase());

  if (error) return NextResponse.json({ error: 'Failed to remove address' }, { status: 500 });
  return NextResponse.json({ ok: true });
}
