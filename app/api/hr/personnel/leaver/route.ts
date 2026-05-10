import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';

const Body = z.object({
  user_id: z.string().uuid(),
  notice_given_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  last_working_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  reason: z.enum(['resigned', 'redundancy', 'dismissal', 'retired', 'end_of_contract', 'other']).optional(),
  exit_interview_done: z.boolean().optional(),
  exit_interview_notes: z.string().nullable().optional(),
  equipment_returned: z.boolean().optional(),
  systems_offboarded: z.boolean().optional(),
  notes: z.string().nullable().optional(),
});

export async function GET(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  const userId = new URL(req.url).searchParams.get('userId') ?? ctx.userId;
  const supabase = createClient();
  const { data, error } = await supabase
    .from('hr_leavers')
    .select('*')
    .eq('firm_id', ctx.firmId)
    .eq('user_id', userId)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ record: data });
}

// POST — admin-only upsert
export async function POST(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  if (ctx.userRole !== 'admin') return NextResponse.json({ error: 'Admin only' }, { status: 403 });
  let body: z.infer<typeof Body>;
  try { body = Body.parse(await req.json()); }
  catch (e) { return NextResponse.json({ error: 'Invalid payload', detail: String(e) }, { status: 400 }); }
  const supabase = createClient();
  const { data, error } = await supabase
    .from('hr_leavers')
    .upsert({
      firm_id: ctx.firmId,
      user_id: body.user_id,
      notice_given_date: body.notice_given_date ?? null,
      last_working_date: body.last_working_date ?? null,
      reason: body.reason ?? null,
      exit_interview_done: body.exit_interview_done ?? false,
      exit_interview_notes: body.exit_interview_notes ?? null,
      equipment_returned: body.equipment_returned ?? false,
      systems_offboarded: body.systems_offboarded ?? false,
      notes: body.notes ?? null,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'firm_id,user_id' })
    .select('*')
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ record: data });
}
