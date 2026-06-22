import { NextRequest, NextResponse } from 'next/server';
import { getUserContext } from '@/lib/getUserContext';
import { createServiceClient } from '@/lib/supabase-server';

// DELETE — disconnect a firm task-sending mailbox (admin only). FK columns that
// reference it (firm default, templates, tasks) are ON DELETE SET NULL, so any
// sender set to this mailbox safely falls back to the owner / firm default.
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  if (ctx.userRole !== 'admin') return NextResponse.json({ error: 'Only firm admins can disconnect a sending mailbox' }, { status: 403 });

  const service = createServiceClient();
  const { error } = await service
    .from('firm_sending_mailboxes')
    .delete()
    .eq('id', params.id)
    .eq('firm_id', ctx.firmId);
  if (error) {
    console.error('[DELETE /api/tasks/sending-mailboxes/[id]]', error);
    return NextResponse.json({ error: 'Failed to disconnect' }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
