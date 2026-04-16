import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';

const PatchSchema = z.object({
  content: z.string().min(1).max(200),
});

// PATCH /api/whiteboard/[id] — edit own note content
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

  const supabase = createClient();
  const { data, error } = await supabase
    .from('whiteboard_messages')
    .update({ content: parsed.data.content })
    .eq('id', params.id)
    .eq('user_id', ctx.userId) // belt-and-braces on top of RLS
    .select()
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
    .eq('user_id', ctx.userId); // belt-and-braces on top of RLS

  if (error) {
    console.error('DELETE /api/whiteboard/[id]', error);
    return NextResponse.json({ error: 'Failed to delete message' }, { status: 500 });
  }

  return new NextResponse(null, { status: 204 });
}
