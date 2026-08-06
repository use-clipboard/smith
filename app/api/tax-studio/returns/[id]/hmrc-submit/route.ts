import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';
import { canAccessTaxStudio } from '@/lib/tax-studio/access';
import { HMRC_ENV } from '@/lib/hmrc/config';
import { buildFraudHeaders, resolveVendorPublicIp, type ClientFraudData } from '@/lib/hmrc/fraudHeaders';
import { resolveMtdItCtx } from '@/lib/hmrc/mtdItServer';
import { itsaTaxYear, submitFinalDeclaration } from '@/lib/tax-studio/hmrc';
import { logTaxAudit } from '@/lib/tax-studio/audit';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// POST /api/tax-studio/returns/[id]/hmrc-submit
// Submits the HMRC final declaration (crystallisation) for a calculationId the
// accountant has reviewed. Records a receipt and marks the return submitted.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  if (!canAccessTaxStudio(ctx.email)) return NextResponse.json({ error: 'Tax Studio is not available for your account.' }, { status: 403 });

  const body = await req.json().catch(() => ({})) as { calculationId?: string; fraudData?: ClientFraudData; testScenario?: string };
  if (!body.calculationId) return NextResponse.json({ error: 'calculationId is required — run the calculation first.' }, { status: 400 });
  if (!body.fraudData) return NextResponse.json({ error: 'Missing device data for HMRC fraud-prevention headers.' }, { status: 400 });

  const service = createServiceClient();
  const { data: row } = await service
    .from('tax_studio_returns').select('id, data').eq('id', params.id).eq('firm_id', ctx.firmId).single();
  if (!row) return NextResponse.json({ error: 'Return not found.' }, { status: 404 });
  const data = (row.data ?? {}) as Record<string, unknown>;
  const clientId = (data.clientId as string | null) ?? null;
  if (!clientId) return NextResponse.json({ error: 'This return isn’t linked to a client.' }, { status: 400 });

  const r = await resolveMtdItCtx(clientId);
  if (r instanceof NextResponse) return r;

  const fraudHeaders = buildFraudHeaders(req, body.fraudData, { userId: ctx.userId, vendorPublicIp: await resolveVendorPublicIp() });
  const taxYear = itsaTaxYear((data.taxYear as string) ?? '');
  const isTest = HMRC_ENV !== 'production';

  const decl = await submitFinalDeclaration({
    conn: r.conn, nino: r.client.nino, taxYear, fraudHeaders,
    testScenario: body.testScenario, calculationId: body.calculationId,
  });

  // Record the attempt (success or failure) for audit.
  await service.from('tax_studio_submissions').insert({
    firm_id: ctx.firmId,
    return_id: params.id,
    client_id: clientId,
    tax_year: taxYear,
    return_type: (data.returnType as string) ?? 'sa100',
    calculation_id: body.calculationId,
    nino: r.client.nino,
    is_test: isTest,
    hmrc_status: decl.status,
    hmrc_response: decl.json ?? null,
    submitted_by: ctx.userId,
  });

  if (!decl.ok) {
    return NextResponse.json({ error: decl.error ?? 'HMRC rejected the final declaration.', hmrcStatus: decl.status }, { status: 502 });
  }

  // Mark the return submitted (server-authoritative), preserving the rest.
  const nowIso = new Date().toISOString();
  const submissionRef = body.calculationId;
  const nextData = { ...data, approvalStatus: 'submitted', submittedAt: nowIso, submissionRef };
  await service.from('tax_studio_returns')
    .update({ data: nextData, updated_at: nowIso })
    .eq('id', params.id).eq('firm_id', ctx.firmId);

  await logTaxAudit({
    firmId: ctx.firmId, returnId: params.id, clientId,
    clientName: (data.clientName as string) ?? null, actorId: ctx.userId,
    action: 'submitted',
    summary: `Filed SA final declaration to HMRC${isTest ? ' (sandbox)' : ''} — calc ${submissionRef}`,
  });

  return NextResponse.json({ ok: true, submissionRef, isTest, hmrcStatus: decl.status, submittedAt: nowIso });
}
