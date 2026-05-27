import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase-server';
import { getBookkeepingContext } from '@/lib/bookkeeping/server';

// ── /api/bookkeeping/books/[id]/whiteboard/[noteId] ────────────────────────
// PATCH  → update a note (content, colour, position, rotation).
// DELETE → remove a note. Any user with book access can delete (matches the
//          eraser-tool UX — the board belongs to the team, not the author).

const PatchBody = z.object({
  content: z.string().max(2000).optional(),
  color: z.string().optional(),
  pos_x: z.number().min(0).max(100).optional(),
  pos_y: z.number().min(0).max(100).optional(),
  rotation: z.number().min(-15).max(15).optional(),
});

const SELECT = 'id, book_id, kind, content, color, pos_x, pos_y, rotation, author_id, author_name, created_at, updated_at';

async function verifyBook(supabase: ReturnType<typeof createClient>, bookId: string, firmId: string) {
  const { data, error } = await supabase
    .from('bookkeeping_books')
    .select('id')
    .eq('id', bookId)
    .eq('firm_id', firmId)
    .single();
  if (error || !data) return false;
  return true;
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string; noteId: string } }) {
  const ctx = await getBookkeepingContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  let body: z.infer<typeof PatchBody>;
  try { body = PatchBody.parse(await req.json()); }
  catch (e) { return NextResponse.json({ error: 'Invalid payload', detail: String(e) }, { status: 400 }); }

  const supabase = createClient();
  if (!await verifyBook(supabase, params.id, ctx.firmId)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (body.content !== undefined)  patch.content  = body.content;
  if (body.color !== undefined)    patch.color    = body.color;
  if (body.pos_x !== undefined)    patch.pos_x    = body.pos_x;
  if (body.pos_y !== undefined)    patch.pos_y    = body.pos_y;
  if (body.rotation !== undefined) patch.rotation = body.rotation;

  const { data, error } = await supabase
    .from('bookkeeping_whiteboard_notes')
    .update(patch)
    .eq('id', params.noteId)
    .eq('book_id', params.id)
    .select(SELECT)
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data)  return NextResponse.json({ error: 'Not found' }, { status: 404 });

  return NextResponse.json({ note: data });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string; noteId: string } }) {
  const ctx = await getBookkeepingContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const supabase = createClient();
  if (!await verifyBook(supabase, params.id, ctx.firmId)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const { error } = await supabase
    .from('bookkeeping_whiteboard_notes')
    .delete()
    .eq('id', params.noteId)
    .eq('book_id', params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
