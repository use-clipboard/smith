import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';

const Body = z.object({
  user_id: z.string().uuid(),
  document_type: z.enum(['passport', 'brp', 'share_code', 'visa', 'other']),
  document_reference: z.string().nullable().optional(),
  expiry_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  evidence_url: z.string().url().nullable().optional(),
  notes: z.string().nullable().optional(),
});

// GET /api/hr/personnel/right-to-work?userId=…
export async function GET(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  const userId = new URL(req.url).searchParams.get('userId') ?? ctx.userId;
  const supabase = createClient();
  const { data, error } = await supabase
    .from('hr_right_to_work')
    .select('*, checker:users!checked_by ( id, full_name, email )')
    .eq('firm_id', ctx.firmId)
    .eq('user_id', userId)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ record: data });
}

// POST /api/hr/personnel/right-to-work — admin upsert
export async function POST(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  if (ctx.userRole !== 'admin') return NextResponse.json({ error: 'Admin only' }, { status: 403 });

  let body: z.infer<typeof Body>;
  try { body = Body.parse(await req.json()); }
  catch (e) { return NextResponse.json({ error: 'Invalid payload', detail: String(e) }, { status: 400 }); }

  const supabase = createClient();
  const { data, error } = await supabase
    .from('hr_right_to_work')
    .upsert({
      firm_id: ctx.firmId,
      user_id: body.user_id,
      document_type: body.document_type,
      document_reference: body.document_reference ?? null,
      expiry_date: body.expiry_date ?? null,
      evidence_url: body.evidence_url ?? null,
      notes: body.notes ?? null,
      checked_by: ctx.userId,
      checked_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }, { onConflict: 'firm_id,user_id' })
    .select('*')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ record: data });
}
