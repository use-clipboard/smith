import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';

const PutSchema = z.object({
  layout: z.array(z.string()).max(50),
});

// GET /api/users/dashboard-layout
export async function GET() {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const supabase = createClient();
  const { data, error } = await supabase
    .from('users')
    .select('dashboard_layout')
    .eq('id', ctx.userId)
    .single();

  if (error) return NextResponse.json({ layout: null });
  return NextResponse.json({ layout: (data?.dashboard_layout as string[] | null) ?? null });
}

// PUT /api/users/dashboard-layout
export async function PUT(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  let body: unknown;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const parsed = PutSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input' }, { status: 400 });
  }

  const supabase = createClient();
  const { error } = await supabase
    .from('users')
    .update({ dashboard_layout: parsed.data.layout })
    .eq('id', ctx.userId);

  if (error) {
    console.error('PUT /api/users/dashboard-layout', error);
    return NextResponse.json({ error: 'Failed to save' }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
