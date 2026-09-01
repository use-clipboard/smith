import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';
import { normaliseOrganiseSettings } from '@/lib/tasks/organiseSettings';

// Per-user "Organise my day" planner preferences (users.organise_my_day_settings).
// Each user sets their own working-day shape; never firm-wide.

export async function GET() {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  const supabase = createClient();
  const { data } = await supabase.from('users').select('organise_my_day_settings').eq('id', ctx.userId).maybeSingle();
  return NextResponse.json({ settings: normaliseOrganiseSettings((data as { organise_my_day_settings?: unknown } | null)?.organise_my_day_settings) });
}

const Body = z.object({
  workStartMin:  z.number().int().min(0).max(24 * 60),
  workEndMin:    z.number().int().min(0).max(24 * 60),
  lunchStartMin: z.number().int().min(0).max(24 * 60).nullable(),
  lunchMinutes:  z.number().int().min(0).max(180),
  bufferMinutes: z.number().int().min(0).max(60),
  wrapMinutes:   z.number().int().min(0).max(120),
});

export async function PUT(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  let raw: unknown;
  try { raw = Body.parse(await req.json()); }
  catch (e) { return NextResponse.json({ error: 'Invalid payload', detail: String(e) }, { status: 400 }); }
  // Re-normalise so end>start, lunch inside the day, etc. are always coherent.
  const settings = normaliseOrganiseSettings(raw);
  const supabase = createClient();
  const { error } = await supabase.from('users').update({ organise_my_day_settings: settings }).eq('id', ctx.userId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, settings });
}
