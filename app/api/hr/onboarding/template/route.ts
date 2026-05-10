import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';

const Body = z.object({
  title: z.string().min(1),
  description: z.string().nullable().optional(),
  default_assignee_role: z.enum(['admin', 'manager', 'staff']).nullable().optional(),
  due_days_after_start: z.number().int().min(0).optional(),
  display_order: z.number().int().optional(),
});

export async function GET() {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  const supabase = createClient();
  const { data, error } = await supabase
    .from('hr_onboarding_template')
    .select('*')
    .eq('firm_id', ctx.firmId)
    .order('display_order', { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ items: data ?? [] });
}

export async function POST(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  if (ctx.userRole !== 'admin') return NextResponse.json({ error: 'Admin only' }, { status: 403 });
  let body: z.infer<typeof Body>;
  try { body = Body.parse(await req.json()); }
  catch (e) { return NextResponse.json({ error: 'Invalid payload', detail: String(e) }, { status: 400 }); }
  const supabase = createClient();
  const { data, error } = await supabase
    .from('hr_onboarding_template')
    .insert({
      firm_id: ctx.firmId,
      title: body.title,
      description: body.description ?? null,
      default_assignee_role: body.default_assignee_role ?? null,
      due_days_after_start: body.due_days_after_start ?? 0,
      display_order: body.display_order ?? 0,
    })
    .select('*')
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ item: data });
}
