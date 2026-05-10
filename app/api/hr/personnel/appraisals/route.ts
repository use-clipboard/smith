import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';

const Body = z.object({
  user_id: z.string().uuid(),
  reviewer_id: z.string().uuid().optional(),
  period_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  period_end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  rating: z.enum(['exceeds', 'meets', 'developing', 'below']).nullable().optional(),
  achievements: z.string().nullable().optional(),
  development_areas: z.string().nullable().optional(),
  goals: z.string().nullable().optional(),
});

export async function GET(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  const userId = new URL(req.url).searchParams.get('userId') ?? ctx.userId;
  const supabase = createClient();
  const { data, error } = await supabase
    .from('hr_appraisals')
    .select('*, reviewer:users!reviewer_id ( id, full_name, email )')
    .eq('firm_id', ctx.firmId)
    .eq('user_id', userId)
    .order('period_end', { ascending: false, nullsFirst: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ records: data ?? [] });
}

export async function POST(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  let body: z.infer<typeof Body>;
  try { body = Body.parse(await req.json()); }
  catch (e) { return NextResponse.json({ error: 'Invalid payload', detail: String(e) }, { status: 400 }); }
  const supabase = createClient();
  const { data, error } = await supabase
    .from('hr_appraisals')
    .insert({
      firm_id: ctx.firmId,
      user_id: body.user_id,
      reviewer_id: body.reviewer_id ?? ctx.userId,
      period_start: body.period_start ?? null,
      period_end: body.period_end ?? null,
      rating: body.rating ?? null,
      achievements: body.achievements ?? null,
      development_areas: body.development_areas ?? null,
      goals: body.goals ?? null,
      status: 'draft',
    })
    .select('*')
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ record: data });
}
