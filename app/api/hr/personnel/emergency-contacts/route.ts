import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';

const CreateBody = z.object({
  user_id: z.string().uuid().optional(), // omit = self
  name: z.string().min(1),
  relationship: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  email: z.string().email().nullable().optional(),
  is_primary: z.boolean().optional(),
});

// GET /api/hr/personnel/emergency-contacts?userId=…
export async function GET(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  const userId = new URL(req.url).searchParams.get('userId') ?? ctx.userId;
  const supabase = createClient();
  const { data, error } = await supabase
    .from('hr_emergency_contacts')
    .select('*')
    .eq('firm_id', ctx.firmId)
    .eq('user_id', userId)
    .order('is_primary', { ascending: false })
    .order('name', { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ contacts: data ?? [] });
}

// POST — create. Staff manage their own contacts; admin can create for anyone.
export async function POST(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  let body: z.infer<typeof CreateBody>;
  try { body = CreateBody.parse(await req.json()); }
  catch (e) { return NextResponse.json({ error: 'Invalid payload', detail: String(e) }, { status: 400 }); }
  const targetUserId = body.user_id ?? ctx.userId;
  if (targetUserId !== ctx.userId && ctx.userRole !== 'admin') {
    return NextResponse.json({ error: 'You can only manage your own emergency contacts.' }, { status: 403 });
  }
  const supabase = createClient();
  const { data, error } = await supabase
    .from('hr_emergency_contacts')
    .insert({
      firm_id: ctx.firmId,
      user_id: targetUserId,
      name: body.name,
      relationship: body.relationship ?? null,
      phone: body.phone ?? null,
      email: body.email ?? null,
      is_primary: body.is_primary ?? false,
    })
    .select('*')
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ contact: data });
}
