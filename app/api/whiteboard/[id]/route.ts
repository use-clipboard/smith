import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';

// ── /api/whiteboard/[id] ────────────────────────────────────────────────────
// PATCH  → update own note (content / colour / position / rotation).
// DELETE → remove own note.
//
// RLS already restricts both to the note's owner; we layer an explicit
// user_id check as belt-and-braces.

const PatchSchema = z.object({
  content: z.string().min(1).max(500).optional(),
  color: z.string().optional(),
  pos_x: z.number().min(0).max(100).optional(),
  pos_y: z.number().min(0).max(100).optional(),
  rotation: z.number().min(-15).max(15).optional(),
});

const SELECT = 'id, content, color, author_name, created_at, user_id, kind, pos_x, pos_y, rotation';

// PATCH /api/whiteboard/[id] — edit own note (content/colour/position)
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  let body: unknown;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input' }, { status: 400 });
  }

  const patch: Record<string, unknown> = {};
  if (parsed.data.content  !== undefined) patch.content  = parsed.data.content;
  if (parsed.data.color    !== undefined) patch.color    = parsed.data.color;
  if (parsed.data.pos_x    !== undefined) patch.pos_x    = parsed.data.pos_x;
  if (parsed.data.pos_y    !== undefined) patch.pos_y    = parsed.data.pos_y;
  if (parsed.data.rotation !== undefined) patch.rotation = parsed.data.rotation;

  const supabase = createClient();
  const { data, error } = await supabase
    .from('whiteboard_messages')
    .update(patch)
    .eq('id', params.id)
    .eq('user_id', ctx.userId)
    .select(SELECT)
    .single();

  if (error) {
    console.error('PATCH /api/whiteboard/[id]', error);
    return NextResponse.json({ error: 'Failed to update message' }, { status: 500 });
  }

  return NextResponse.json({ message: data });
}

// DELETE /api/whiteboard/[id] — delete own note
export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const supabase = createClient();

  // RLS will reject if the note doesn't belong to this user
  const { error } = await supabase
    .from('whiteboard_messages')
    .delete()
    .eq('id', params.id)
    .eq('user_id', ctx.userId);

  if (error) {
    console.error('DELETE /api/whiteboard/[id]', error);
    return NextResponse.json({ error: 'Failed to delete message' }, { status: 500 });
  }

  return new NextResponse(null, { status: 204 });
}
