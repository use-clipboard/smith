import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';

const Body = z.object({
  user_id: z.string().uuid(),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  status: z.enum(['active', 'passed', 'failed', 'extended', 'cancelled']).optional(),
  outcome_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  outcome_notes: z.string().nullable().optional(),
});

// GET /api/hr/personnel/probation?userId=…
export async function GET(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  const userId = new URL(req.url).searchParams.get('userId') ?? ctx.userId;
  const supabase = createClient();
  const { data, error } = await supabase
    .from('hr_probation')
    .select('*')
    .eq('firm_id', ctx.firmId)
    .eq('user_id', userId)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ record: data });
}

// POST — upsert (manager of target or admin)
export async function POST(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  let body: z.infer<typeof Body>;
  try { body = Body.parse(await req.json()); }
  catch (e) { return NextResponse.json({ error: 'Invalid payload', detail: String(e) }, { status: 400 }); }

  const supabase = createClient();
  const { data, error } = await supabase
    .from('hr_probation')
    .upsert({
      firm_id: ctx.firmId,
      user_id: body.user_id,
      start_date: body.start_date,
      end_date: body.end_date ?? null,
      status: body.status ?? 'active',
      outcome_date: body.outcome_date ?? null,
      outcome_notes: body.outcome_notes ?? null,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'firm_id,user_id' })
    .select('*')
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ record: data });
}
