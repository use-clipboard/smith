import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';

const PatchSchema = z.object({
  enabled: z.boolean().optional(),
  daily_input_token_cap:  z.number().int().positive().optional(),
  daily_output_token_cap: z.number().int().positive().optional(),
});

// GET /api/agent/settings — current firm-wide Agent Smith config + usage
export async function GET() {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  if (ctx.userRole !== 'admin') return NextResponse.json({ error: 'Admin only' }, { status: 403 });

  const supabase = createClient();
  const { data } = await supabase.from('agent_settings').select('*').eq('firm_id', ctx.firmId).maybeSingle();
  if (!data) {
    // Seed defaults on first read
    const { data: created } = await supabase.from('agent_settings').insert({ firm_id: ctx.firmId }).select().single();
    return NextResponse.json({ settings: created });
  }
  return NextResponse.json({ settings: data });
}

// PATCH /api/agent/settings
export async function PATCH(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  if (ctx.userRole !== 'admin') return NextResponse.json({ error: 'Admin only' }, { status: 403 });

  const body = await req.json().catch(() => null);
  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'Invalid input' }, { status: 400 });

  const supabase = createClient();
  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (parsed.data.enabled !== undefined) update.enabled = parsed.data.enabled;
  if (parsed.data.daily_input_token_cap)  update.daily_input_token_cap  = parsed.data.daily_input_token_cap;
  if (parsed.data.daily_output_token_cap) update.daily_output_token_cap = parsed.data.daily_output_token_cap;

  const { error } = await supabase.from('agent_settings').upsert({
    firm_id: ctx.firmId, ...update,
  }, { onConflict: 'firm_id' });

  if (error) {
    console.error('PATCH /api/agent/settings', error);
    return NextResponse.json({ error: 'Failed to save settings' }, { status: 500 });
  }
  return NextResponse.json({ success: true });
}
