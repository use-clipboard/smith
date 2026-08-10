import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';
import { canAccessTaxStudio } from '@/lib/tax-studio/access';
import { logTaxAudit } from '@/lib/tax-studio/audit';

export const dynamic = 'force-dynamic';

// POST /api/tax-studio/returns/[id]/mark-approval-sent
// Flip the return to 'sent' after the approval email is really sent from the
// compose window (server-authoritative). Never regresses approved/submitted.
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  if (!canAccessTaxStudio(ctx.activeModules)) return NextResponse.json({ error: 'Tax Studio is not available for your account.' }, { status: 403 });

  const supabase = createClient();
  const { data: row } = await supabase
    .from('tax_studio_returns').select('id, data').eq('id', params.id).eq('firm_id', ctx.firmId).maybeSingle();
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const d = (row.data ?? {}) as Record<string, unknown>;
  const status = d.approvalStatus as string | undefined;

  if (status !== 'approved' && status !== 'submitted' && status !== 'sent') {
    const nextData = { ...d, approvalStatus: 'sent', sentAt: new Date().toISOString() };
    await supabase.from('tax_studio_returns')
      .update({ data: nextData, updated_at: new Date().toISOString() })
      .eq('id', params.id).eq('firm_id', ctx.firmId);
    await logTaxAudit({ firmId: ctx.firmId, returnId: params.id, clientId: (d.clientId as string | null) ?? null, clientName: (d.clientName as string) ?? null, actorId: ctx.userId, action: 'sent', summary: 'Approval pack sent to client' });
  }

  return NextResponse.json({ ok: true });
}
