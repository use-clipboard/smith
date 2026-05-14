import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';

/**
 * Personal sticky notes — private per user.
 *
 * GET   /api/sticky-notes  → list this user's notes
 * POST  /api/sticky-notes  → create one
 *
 * See [id]/route.ts for PATCH and DELETE.
 */

const ColorEnum = z.enum(['yellow', 'pink', 'blue', 'green', 'purple', 'gray']);

const CreateSchema = z.object({
  content:      z.unknown().optional(),
  position_x:   z.number().int().optional(),
  position_y:   z.number().int().optional(),
  width:        z.number().int().min(160).max(800).optional(),
  height:       z.number().int().min(120).max(800).optional(),
  color:        ColorEnum.optional(),
  z_order:      z.number().int().optional(),
  is_minimised: z.boolean().optional(),
});

export async function GET() {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ notes: [] }, { status: 401 });

  const supabase = createClient();
  const { data, error } = await supabase
    .from('personal_sticky_notes')
    .select('*')
    .eq('user_id', ctx.userId)
    .order('z_order', { ascending: true });

  if (error) {
    console.error('GET /api/sticky-notes', error);
    return NextResponse.json({ notes: [], error: 'fetch_failed' }, { status: 500 });
  }
  return NextResponse.json({ notes: data ?? [] });
}

export async function POST(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const parsed = CreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', issues: parsed.error.flatten() }, { status: 400 });
  }

  const supabase = createClient();
  const insert: Record<string, unknown> = {
    user_id: ctx.userId,
    firm_id: ctx.firmId,
  };
  if (parsed.data.content      !== undefined) insert.content      = parsed.data.content;
  if (parsed.data.position_x   !== undefined) insert.position_x   = parsed.data.position_x;
  if (parsed.data.position_y   !== undefined) insert.position_y   = parsed.data.position_y;
  if (parsed.data.width        !== undefined) insert.width        = parsed.data.width;
  if (parsed.data.height       !== undefined) insert.height       = parsed.data.height;
  if (parsed.data.color        !== undefined) insert.color        = parsed.data.color;
  if (parsed.data.z_order      !== undefined) insert.z_order      = parsed.data.z_order;
  if (parsed.data.is_minimised !== undefined) insert.is_minimised = parsed.data.is_minimised;

  const { data, error } = await supabase
    .from('personal_sticky_notes')
    .insert(insert)
    .select('*')
    .single();

  if (error || !data) {
    console.error('POST /api/sticky-notes', error);
    return NextResponse.json({ error: 'Could not create sticky note' }, { status: 500 });
  }
  return NextResponse.json({ note: data });
}
