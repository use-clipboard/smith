import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';

// Per-user persisted Organise-my-day plan for a given day (organise_my_day_plans).
// The stored `plan` jsonb is the block layout; task status is overlaid live on
// the client, so completions elsewhere reflect without re-saving.

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  const date = new URL(req.url).searchParams.get('date') ?? '';
  if (!DATE.test(date)) return NextResponse.json({ error: 'Invalid date' }, { status: 400 });
  const supabase = createClient();
  const { data } = await supabase
    .from('organise_my_day_plans')
    .select('plan')
    .eq('user_id', ctx.userId).eq('plan_date', date)
    .maybeSingle();
  return NextResponse.json({ plan: (data as { plan?: unknown } | null)?.plan ?? null });
}

const Body = z.object({
  date: z.string().regex(DATE),
  plan: z.object({}).passthrough(),   // opaque block layout, validated client-side
});

export async function PUT(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  let body: z.infer<typeof Body>;
  try { body = Body.parse(await req.json()); }
  catch (e) { return NextResponse.json({ error: 'Invalid payload', detail: String(e) }, { status: 400 }); }
  const supabase = createClient();
  const { error } = await supabase
    .from('organise_my_day_plans')
    .upsert({ user_id: ctx.userId, plan_date: body.date, plan: body.plan, updated_at: new Date().toISOString() }, { onConflict: 'user_id,plan_date' });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
