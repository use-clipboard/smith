import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';

/**
 * POST /api/proposals/[id]/mark-sent
 *
 * Flips the proposal's status to 'sent' and stamps sent_at. Called by the
 * proposal builder ONLY after the in-app Compose window successfully
 * dispatches the email — that way a user who opens Compose then cancels
 * doesn't leave the proposal looking sent. Idempotent: re-running on an
 * already-sent proposal is a no-op.
 */
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const supabase = createClient();
  const { data: existing } = await supabase
    .from('proposals')
    .select('id, status, sent_at')
    .eq('id', params.id)
    .eq('firm_id', ctx.firmId)
    .maybeSingle();
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // Already sent / viewed / accepted etc — nothing to do.
  if (existing.status !== 'draft') {
    return NextResponse.json({ ok: true, alreadySent: true, status: existing.status });
  }

  const { error } = await supabase
    .from('proposals')
    .update({
      status:     'sent',
      sent_at:    new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', params.id)
    .eq('firm_id', ctx.firmId);
  if (error) {
    console.error('[POST /api/proposals/[id]/mark-sent]', error);
    return NextResponse.json({ error: 'Failed to mark sent', detail: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
