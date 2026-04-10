import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';

const NOTE_TYPES = ['phone_call', 'meeting', 'conversation', 'email', 'other'] as const;

const UpdateNoteSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  content: z.string().optional(),
  note_type: z.enum(NOTE_TYPES).optional(),
  note_date: z.string().optional(),
  is_pinned: z.boolean().optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string; noteId: string } }
) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const parsed = UpdateNoteSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' }, { status: 400 });

  const supabase = createClient();

  const { data: existing } = await supabase
    .from('client_timeline_notes')
    .select('id')
    .eq('id', params.noteId)
    .eq('client_id', params.id)
    .eq('firm_id', ctx.firmId)
    .single();

  if (!existing) return NextResponse.json({ error: 'Note not found' }, { status: 404 });

  const d = parsed.data;
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (d.title !== undefined) updates.title = d.title;
  if (d.content !== undefined) updates.content = d.content;
  if (d.note_type !== undefined) updates.note_type = d.note_type;
  if (d.note_date !== undefined) updates.note_date = d.note_date;
  if (d.is_pinned !== undefined) updates.is_pinned = d.is_pinned;

  const { data: note, error } = await supabase
    .from('client_timeline_notes')
    .update(updates)
    .eq('id', params.noteId)
    .select('*, users(full_name)')
    .single();

  if (error) {
    console.error('PATCH /api/clients/[id]/notes/[noteId]', error);
    return NextResponse.json({ error: 'Failed to update note' }, { status: 500 });
  }

  return NextResponse.json({ note });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string; noteId: string } }
) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const supabase = createClient();

  const { data: existing } = await supabase
    .from('client_timeline_notes')
    .select('id')
    .eq('id', params.noteId)
    .eq('client_id', params.id)
    .eq('firm_id', ctx.firmId)
    .single();

  if (!existing) return NextResponse.json({ error: 'Note not found' }, { status: 404 });

  const { error } = await supabase
    .from('client_timeline_notes')
    .delete()
    .eq('id', params.noteId);

  if (error) {
    console.error('DELETE /api/clients/[id]/notes/[noteId]', error);
    return NextResponse.json({ error: 'Failed to delete note' }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
