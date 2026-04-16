import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';

const PutSchema = z.object({
  favourites: z.array(z.string()).max(50),
});

// GET /api/users/favourites
export async function GET() {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const supabase = createClient();
  const { data, error } = await supabase
    .from('users')
    .select('favourites')
    .eq('id', ctx.userId)
    .single();

  if (error) return NextResponse.json({ favourites: [] });
  return NextResponse.json({ favourites: (data?.favourites as string[]) ?? [] });
}

// PUT /api/users/favourites
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
    .update({ favourites: parsed.data.favourites })
    .eq('id', ctx.userId);

  if (error) {
    console.error('PUT /api/users/favourites', error);
    return NextResponse.json({ error: 'Failed to save' }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
