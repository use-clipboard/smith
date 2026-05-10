import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';

const Body = z.object({
  staff_user_id: z.string().uuid(),
  manager_user_id: z.string().uuid(),
  meeting_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  notes: z.string().nullable().optional(),
  action_items: z.string().nullable().optional(),
});

// GET ?staffUserId=&managerUserId= — returns 1:1 history between this pair
export async function GET(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  const url = new URL(req.url);
  const staffUserId = url.searchParams.get('staffUserId');
  const managerUserId = url.searchParams.get('managerUserId');
  const supabase = createClient();
  let query = supabase
    .from('hr_one_to_ones')
    .select('*, staff:users!staff_user_id ( id, full_name, email ), manager:users!manager_user_id ( id, full_name, email )')
    .eq('firm_id', ctx.firmId);
  if (staffUserId) query = query.eq('staff_user_id', staffUserId);
  if (managerUserId) query = query.eq('manager_user_id', managerUserId);
  query = query.order('meeting_date', { ascending: false });
  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ records: data ?? [] });
}

export async function POST(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  let body: z.infer<typeof Body>;
  try { body = Body.parse(await req.json()); }
  catch (e) { return NextResponse.json({ error: 'Invalid payload', detail: String(e) }, { status: 400 }); }
  // Caller must be a party to the 1:1 (RLS enforces too)
  if (body.staff_user_id !== ctx.userId && body.manager_user_id !== ctx.userId) {
    return NextResponse.json({ error: 'You must be a party to a 1:1 to record it.' }, { status: 403 });
  }
  const supabase = createClient();
  const { data, error } = await supabase
    .from('hr_one_to_ones')
    .insert({
      firm_id: ctx.firmId,
      staff_user_id: body.staff_user_id,
      manager_user_id: body.manager_user_id,
      meeting_date: body.meeting_date,
      notes: body.notes ?? null,
      action_items: body.action_items ?? null,
    })
    .select('*')
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ record: data });
}
