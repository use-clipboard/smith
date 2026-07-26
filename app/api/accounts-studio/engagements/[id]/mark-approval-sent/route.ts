import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';
import { canAccessAccountsStudio } from '@/lib/accounts-studio/access';
import { logAuditEvent } from '@/lib/accounts-studio/audit';
import type { Engagement } from '@/components/features/accounts-studio/types';

// POST /api/accounts-studio/engagements/[id]/mark-approval-sent
// Flips the engagement status to 'sent' — called ONLY once the approval email
// has actually been sent (from the compose window). The send-approval route no
// longer sets 'sent' for the compose (prepare_only) flow, so cancelling the
// draft never leaves a false "Sent" status. Never regresses approved/submitted.
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  if (!canAccessAccountsStudio(ctx.email)) return NextResponse.json({ error: 'Accounts Studio is not available for your account.' }, { status: 403 });

  const supabase = createClient();
  const { data: row } = await supabase
    .from('accounts_studio_engagements').select('id, data')
    .eq('id', params.id).eq('firm_id', ctx.firmId).maybeSingle();
  if (!row) return NextResponse.json({ error: 'Accounts not found' }, { status: 404 });

  const e = (row.data ?? {}) as Engagement;
  if (e.approvalStatus === 'approved' || e.approvalStatus === 'submitted') {
    return NextResponse.json({ engagement: { id: row.id, data: e } });
  }
  const nextData: Engagement = { ...e, approvalStatus: 'sent', sentAt: new Date().toISOString() };
  await supabase.from('accounts_studio_engagements')
    .update({ data: nextData, updated_at: new Date().toISOString() })
    .eq('id', params.id).eq('firm_id', ctx.firmId);

  await logAuditEvent({
    firmId: ctx.firmId,
    engagementId: params.id,
    clientId: e.clientId ?? null,
    companyName: e.companyName ?? null,
    actorId: ctx.userId,
    action: 'sent_for_approval',
    summary: 'Sent to the client for approval',
  });

  return NextResponse.json({ engagement: { id: row.id, data: nextData } });
}
