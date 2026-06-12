import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';

// POST /api/clients/[id]/notes/[noteId]/reallocate — ADMIN ONLY.
// Moves a timeline entry to a different client, so admins can fix
// misallocations. For email entries the email_allocations rows move too (they
// drive the "Allocated to" badges in Email Triage and the unallocate path).

const Schema = z.object({
  targetClientId: z.string().uuid(),
});

export async function POST(req: NextRequest, { params }: { params: { id: string; noteId: string } }) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  if (ctx.userRole !== 'admin') {
    return NextResponse.json({ error: 'Only firm admins can reallocate timeline entries' }, { status: 403 });
  }

  const parsed = Schema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const { targetClientId } = parsed.data;
  if (targetClientId === params.id) {
    return NextResponse.json({ error: 'The entry is already on this client' }, { status: 400 });
  }

  const supabase = createClient();

  // The note must belong to this firm and to the client in the URL.
  const { data: note } = await supabase
    .from('client_timeline_notes')
    .select('id, note_type')
    .eq('id', params.noteId)
    .eq('firm_id', ctx.firmId)
    .eq('client_id', params.id)
    .single();
  if (!note) return NextResponse.json({ error: 'Note not found' }, { status: 404 });

  // The target client must belong to the same firm.
  const { data: target } = await supabase
    .from('clients')
    .select('id, name')
    .eq('id', targetClientId)
    .eq('firm_id', ctx.firmId)
    .single();
  if (!target) return NextResponse.json({ error: 'Target client not found' }, { status: 404 });

  const { error: noteError } = await supabase
    .from('client_timeline_notes')
    .update({ client_id: targetClientId })
    .eq('id', params.noteId)
    .eq('firm_id', ctx.firmId);
  if (noteError) {
    console.error('reallocate note update', noteError);
    return NextResponse.json({ error: 'Failed to reallocate' }, { status: 500 });
  }

  // Email entries: move the allocation rows with the note. If the target
  // client already has an allocation for the same message (unique constraint),
  // drop this note's rows — the email is already on the target timeline, and
  // the moved note now sits alongside it (the app-level dedupe prevents NEW
  // duplicates; an admin can delete the spare if one arises here).
  if (note.note_type === 'email') {
    const { error: allocError } = await supabase
      .from('email_allocations')
      .update({ client_id: targetClientId })
      .eq('timeline_entry_id', params.noteId)
      .eq('firm_id', ctx.firmId);
    if (allocError) {
      await supabase
        .from('email_allocations')
        .delete()
        .eq('timeline_entry_id', params.noteId)
        .eq('firm_id', ctx.firmId);
    }
  }

  return NextResponse.json({ ok: true, targetClientName: target.name });
}
