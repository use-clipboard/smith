import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createServiceClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';

// ── /api/whiteboard/[id] ────────────────────────────────────────────────────
// Team Noticeboard permissions:
//   • MOVE   (pos_x / pos_y / rotation) — any member of the firm.
//   • EDIT   (content / colour)         — the original poster only.
//   • DELETE                            — the original poster OR any admin.
//
// We resolve the note via the service client (bypassing RLS) and enforce the
// rules above explicitly here, so a non-owner can reposition a note and an
// admin can clear someone else's note while edits stay owner-locked.

const PatchSchema = z.object({
  content: z.string().min(1).max(500).optional(),
  color: z.string().optional(),
  pos_x: z.number().min(0).max(100).optional(),
  pos_y: z.number().min(0).max(100).optional(),
  rotation: z.number().min(-15).max(15).optional(),
});

const SELECT = 'id, content, color, author_name, created_at, user_id, kind, pos_x, pos_y, rotation';

// PATCH /api/whiteboard/[id]
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

  const supabase = createServiceClient();

  // Resolve the note so we can apply firm + ownership rules.
  const { data: note } = await supabase
    .from('whiteboard_messages')
    .select('user_id, firm_id')
    .eq('id', params.id)
    .single();

  if (!note) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (note.firm_id !== ctx.firmId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // Content / colour are edits — original poster only. Position / rotation
  // (moving the note) is allowed for anyone in the firm.
  const isEdit = parsed.data.content !== undefined || parsed.data.color !== undefined;
  if (isEdit && note.user_id !== ctx.userId) {
    return NextResponse.json({ error: 'Only the original poster can edit this note' }, { status: 403 });
  }

  const patch: Record<string, unknown> = {};
  if (parsed.data.content  !== undefined) patch.content  = parsed.data.content;
  if (parsed.data.color    !== undefined) patch.color    = parsed.data.color;
  if (parsed.data.pos_x    !== undefined) patch.pos_x    = parsed.data.pos_x;
  if (parsed.data.pos_y    !== undefined) patch.pos_y    = parsed.data.pos_y;
  if (parsed.data.rotation !== undefined) patch.rotation = parsed.data.rotation;

  const { data, error } = await supabase
    .from('whiteboard_messages')
    .update(patch)
    .eq('id', params.id)
    .select(SELECT)
    .single();

  if (error) {
    console.error('PATCH /api/whiteboard/[id]', error);
    return NextResponse.json({ error: 'Failed to update message' }, { status: 500 });
  }

  return NextResponse.json({ message: data });
}

// DELETE /api/whiteboard/[id] — original poster or any admin
export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const supabase = createServiceClient();

  const { data: note } = await supabase
    .from('whiteboard_messages')
    .select('user_id, firm_id')
    .eq('id', params.id)
    .single();

  if (!note) return new NextResponse(null, { status: 204 }); // already gone
  if (note.firm_id !== ctx.firmId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  if (note.user_id !== ctx.userId && ctx.userRole !== 'admin') {
    return NextResponse.json({ error: 'Only the poster or an admin can delete this note' }, { status: 403 });
  }

  const { error } = await supabase
    .from('whiteboard_messages')
    .delete()
    .eq('id', params.id);

  if (error) {
    console.error('DELETE /api/whiteboard/[id]', error);
    return NextResponse.json({ error: 'Failed to delete message' }, { status: 500 });
  }

  return new NextResponse(null, { status: 204 });
}
