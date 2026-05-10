import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient, createServiceClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';

const Body = z.object({
  user_id: z.string().uuid(),
  effective_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  annual_salary: z.number().positive(),
  currency: z.string().length(3).optional(),
  notes: z.string().nullable().optional(),
});

// GET /api/hr/personnel/salary?userId=…
// Reading triggers an audit row. Subject can see own; admins see all.
// Returns ALL salary records (history) for that user.
export async function GET(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  const userId = new URL(req.url).searchParams.get('userId') ?? ctx.userId;

  // Authorisation enforced by RLS, but we still want to audit if a non-self
  // viewer succeeds in reading.
  const supabase = createClient();
  const { data, error } = await supabase
    .from('hr_salary_records')
    .select('*, creator:users!created_by ( id, full_name, email )')
    .eq('firm_id', ctx.firmId)
    .eq('user_id', userId)
    .order('effective_date', { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Audit only when caller isn't the subject
  if (userId !== ctx.userId && (data?.length ?? 0) > 0) {
    const service = createServiceClient();
    void service.from('hr_salary_audit').insert({
      firm_id: ctx.firmId,
      salary_user_id: userId,
      accessed_by: ctx.userId,
    });
  }

  return NextResponse.json({ records: data ?? [] });
}

// POST — admin-only new salary entry
export async function POST(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  if (ctx.userRole !== 'admin') return NextResponse.json({ error: 'Admin only' }, { status: 403 });
  let body: z.infer<typeof Body>;
  try { body = Body.parse(await req.json()); }
  catch (e) { return NextResponse.json({ error: 'Invalid payload', detail: String(e) }, { status: 400 }); }
  const supabase = createClient();
  const { data, error } = await supabase
    .from('hr_salary_records')
    .insert({
      firm_id: ctx.firmId,
      user_id: body.user_id,
      effective_date: body.effective_date,
      annual_salary: body.annual_salary,
      currency: body.currency ?? 'GBP',
      notes: body.notes ?? null,
      created_by: ctx.userId,
    })
    .select('*')
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ record: data });
}
