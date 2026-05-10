import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';

const Body = z.object({
  user_id: z.string().uuid().optional(),
  title: z.string().min(1),
  provider: z.string().nullable().optional(),
  hours: z.number().min(0).optional(),
  date_completed: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  cpd_year: z.string().nullable().optional(),
  certificate_url: z.string().url().nullable().optional(),
  notes: z.string().nullable().optional(),
});

export async function GET(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  const userId = new URL(req.url).searchParams.get('userId') ?? ctx.userId;
  const supabase = createClient();
  const { data, error } = await supabase
    .from('hr_training_records')
    .select('*')
    .eq('firm_id', ctx.firmId)
    .eq('user_id', userId)
    .order('date_completed', { ascending: false, nullsFirst: false });
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
  if (targetUserId !== ctx.userId && ctx.userRole !== 'admin') {
    return NextResponse.json({ error: 'You can only add training records for yourself.' }, { status: 403 });
  }
  const supabase = createClient();
  const { data, error } = await supabase
    .from('hr_training_records')
    .insert({
      firm_id: ctx.firmId,
      user_id: targetUserId,
      title: body.title,
      provider: body.provider ?? null,
      hours: body.hours ?? 0,
      date_completed: body.date_completed ?? null,
      cpd_year: body.cpd_year ?? null,
      certificate_url: body.certificate_url ?? null,
      notes: body.notes ?? null,
    })
    .select('*')
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ record: data });
}
