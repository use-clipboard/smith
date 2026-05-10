import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';

const Body = z.object({
  user_id: z.string().uuid(),
  amount_hours: z.number(),  // signed: + earned, − used
  date_recorded: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  reason: z.string().nullable().optional(),
});

export async function GET(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  const userId = new URL(req.url).searchParams.get('userId') ?? ctx.userId;
  const supabase = createClient();
  const { data, error } = await supabase
    .from('hr_toil_records')
    .select('*, approver:users!approved_by ( id, full_name, email )')
    .eq('firm_id', ctx.firmId)
    .eq('user_id', userId)
    .order('date_recorded', { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const balance = (data ?? []).reduce((acc, r) => acc + Number(r.amount_hours || 0), 0);
  return NextResponse.json({ records: data ?? [], balance });
}

// POST — manager-of-target or admin
export async function POST(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  let body: z.infer<typeof Body>;
  try { body = Body.parse(await req.json()); }
  catch (e) { return NextResponse.json({ error: 'Invalid payload', detail: String(e) }, { status: 400 }); }
  const supabase = createClient();
  const { data, error } = await supabase
    .from('hr_toil_records')
    .insert({
      firm_id: ctx.firmId,
      user_id: body.user_id,
      amount_hours: body.amount_hours,
      date_recorded: body.date_recorded,
      reason: body.reason ?? null,
      approved_by: ctx.userId,
    })
    .select('*')
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ record: data });
}
