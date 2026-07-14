import { NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';

// POST /api/landlord/approvals/[id]/mark-sent
//
// Flips a PREPARED approval to actually-sent. Called by the Landlord tool when
// the in-app compose window reports a real send ('smith:compose-sent'), because
// in that flow we don't send the email ourselves — the user does, from their own
// Gmail, and they might close the draft instead. Until this fires the row reads
// "Preparing".
//
// Idempotent: an already-sent row is left alone.

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const supabase = createClient();
  const service = createServiceClient();

  // Firm scope via the parent analysis — RLS on landlord_approvals already keys
  // off outputs.firm_id, so this select can't see another firm's row.
  const { data: row } = await supabase
    .from('landlord_approvals')
    .select('id, sent_at, outputs!inner(firm_id)')
    .eq('id', params.id)
    .maybeSingle();
  if (!row) return NextResponse.json({ error: 'Approval not found' }, { status: 404 });

  const firmId = (row as unknown as { outputs?: { firm_id?: string } }).outputs?.firm_id;
  if (firmId !== ctx.firmId) return NextResponse.json({ error: 'Approval not found' }, { status: 404 });

  if (row.sent_at) return NextResponse.json({ ok: true, sent_at: row.sent_at });

  const sentAt = new Date().toISOString();
  const { error } = await service.from('landlord_approvals').update({ sent_at: sentAt }).eq('id', params.id);
  if (error) {
    console.error('POST /api/landlord/approvals/[id]/mark-sent', error);
    return NextResponse.json({ error: 'Failed to record the send' }, { status: 500 });
  }
  return NextResponse.json({ ok: true, sent_at: sentAt });
}
