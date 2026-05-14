import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';

const Schema = z.object({
  notifications_enabled: z.boolean(),
});

export async function GET() {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ notifications_enabled: true }, { status: 401 });

  const supabase = createClient();
  const { data } = await supabase
    .from('users')
    .select('community_notifications_enabled')
    .eq('id', ctx.userId)
    .single();

  return NextResponse.json({
    notifications_enabled: data?.community_notifications_enabled ?? true,
  });
}

export async function PATCH(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const parsed = Schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 });

  const supabase = createClient();
  const { error } = await supabase
    .from('users')
    .update({ community_notifications_enabled: parsed.data.notifications_enabled })
    .eq('id', ctx.userId);

  if (error) {
    console.error('PATCH /api/community/preferences', error);
    return NextResponse.json({ error: 'Could not save preference' }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
