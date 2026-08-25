import { NextRequest, NextResponse } from 'next/server';
import { getUserContext } from '@/lib/getUserContext';
import { createServiceClient } from '@/lib/supabase-server';

// DELETE /api/clients/[id]/service-notes/[noteId] — the author or an admin may remove a note.
export async function DELETE(_req: NextRequest, { params }: { params: { id: string; noteId: string } }) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const service = createServiceClient();
  const { data: note } = await service
    .from('client_service_notes').select('id, created_by')
    .eq('id', params.noteId).eq('firm_id', ctx.firmId).single();
  if (!note) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (note.created_by !== ctx.userId && ctx.userRole !== 'admin') {
    return NextResponse.json({ error: 'Not allowed' }, { status: 403 });
  }

  const { error } = await service.from('client_service_notes').delete().eq('id', params.noteId).eq('firm_id', ctx.firmId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
