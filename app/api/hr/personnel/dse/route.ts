import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';

const Body = z.object({
  user_id: z.string().uuid().optional(),
  assessment_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  responses: z.record(z.string(), z.unknown()).optional(),
  recommendations: z.string().nullable().optional(),
  next_review_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
});

export async function GET(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  const userId = new URL(req.url).searchParams.get('userId') ?? ctx.userId;
  const supabase = createClient();
  const { data, error } = await supabase
    .from('hr_dse_assessments')
    .select('*, assessor:users!assessor_id ( id, full_name, email )')
    .eq('firm_id', ctx.firmId)
    .eq('user_id', userId)
    .order('assessment_date', { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ records: data ?? [] });
}

export async function POST(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  let body: z.infer<typeof Body>;
  try { body = Body.parse(await req.json()); }
  catch (e) { return NextResponse.json({ error: 'Invalid payload', detail: String(e) }, { status: 400 }); }
  const targetUserId = body.user_id ?? ctx.userId;
  const supabase = createClient();
  const { data, error } = await supabase
    .from('hr_dse_assessments')
    .insert({
      firm_id: ctx.firmId,
      user_id: targetUserId,
      assessment_date: body.assessment_date,
      assessor_id: ctx.userId,
      responses: body.responses ?? {},
      recommendations: body.recommendations ?? null,
      next_review_date: body.next_review_date ?? null,
    })
    .select('*')
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ record: data });
}
