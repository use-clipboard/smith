import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';
import { canAccessAccountsStudio } from '@/lib/accounts-studio/access';
import { logAuditEvent } from '@/lib/accounts-studio/audit';
import type { Engagement } from '@/components/features/accounts-studio/types';

// POST /api/accounts-studio/engagements/[id]/mark-submitted
// Marks the accounts as submitted to Companies House. Server-authoritative so
// the status can't be regressed by a stale autosave. (Until the CH filing
// integration is live this is a manual step; it will later be set by the real
// submission.) Only allowed once the client has approved.
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  if (!canAccessAccountsStudio(ctx.email)) return NextResponse.json({ error: 'Accounts Studio is not available for your account.' }, { status: 403 });

  const supabase = createClient();
  const { data: row } = await supabase
    .from('accounts_studio_engagements')
    .select('id, data')
    .eq('id', params.id).eq('firm_id', ctx.firmId)
    .maybeSingle();
  if (!row) return NextResponse.json({ error: 'Accounts not found' }, { status: 404 });

  const e = (row.data ?? {}) as Engagement;
  if (e.approvalStatus === 'submitted') {
    return NextResponse.json({ engagement: { id: row.id, data: e } });
  }
  if (e.approvalStatus !== 'approved') {
    return NextResponse.json({ error: 'The client must approve the accounts before they can be submitted.' }, { status: 409 });
  }

  const nextData: Engagement = { ...e, approvalStatus: 'submitted', submittedAt: new Date().toISOString(), published: true };
  const { error } = await supabase.from('accounts_studio_engagements')
    .update({ data: nextData, published: true, updated_at: new Date().toISOString() })
    .eq('id', params.id).eq('firm_id', ctx.firmId);
  if (error) return NextResponse.json({ error: 'Failed to mark as submitted' }, { status: 500 });

  await logAuditEvent({
    firmId: ctx.firmId,
    engagementId: params.id,
    clientId: e.clientId ?? null,
    companyName: e.companyName ?? null,
    actorId: ctx.userId,
    action: 'marked_submitted',
    summary: 'Marked the accounts as submitted to Companies House',
  });

  return NextResponse.json({ engagement: { id: row.id, data: nextData } });
}
