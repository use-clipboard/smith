import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';
import { canAccessTaxStudio } from '@/lib/tax-studio/access';
import { logTaxAudit } from '@/lib/tax-studio/audit';
import type { TaxReturn } from '@/components/features/tax-studio/types';
import { buildSa100Return } from '@/lib/hmrc-sa/sa100Return';
import { markIrEnvelope } from '@/lib/hmrc-sa/irmark';
import { buildSubmissionEnvelope, submitToGateway, pollGateway, deleteFromGateway, type SaGatewayResult } from '@/lib/hmrc-sa/gateway';
import { saGatewayTestFlag, type SaCreds } from '@/lib/hmrc-sa/config';
import { getSaCredsForFirm, SaFilingNotConfiguredError } from '@/lib/hmrc-sa/getSaCredsForFirm';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// POST /api/tax-studio/returns/[id]/sa-submit
// Files the legacy SA100 online return to HMRC's Transaction Engine: builds the
// SA100 XML → IRmarks it → wraps in the GovTalk envelope → submits, then polls
// for the outcome (bounded in-request; a cron fallback for slow responses is a
// TODO), records a receipt and — on acceptance — marks the return submitted.
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  if (!canAccessTaxStudio(ctx.activeModules)) return NextResponse.json({ error: 'Tax Studio is not available for your account.' }, { status: 403 });

  // Resolve the firm's Government Gateway credentials (firm store → env fallback).
  let saCreds: SaCreds;
  try {
    saCreds = await getSaCredsForFirm(ctx.firmId);
  } catch (e) {
    if (e instanceof SaFilingNotConfiguredError) return NextResponse.json({ error: e.message }, { status: 400 });
    throw e;
  }

  const service = createServiceClient();
  const { data: row } = await service
    .from('tax_studio_returns').select('id, data').eq('id', params.id).eq('firm_id', ctx.firmId).single();
  if (!row) return NextResponse.json({ error: 'Return not found.' }, { status: 404 });

  const data = (row.data ?? {}) as Record<string, unknown>;
  const ret = data as unknown as TaxReturn;
  const clientId = (data.clientId as string | null) ?? null;

  const built = buildSa100Return(ret);
  if (!built.utr) return NextResponse.json({ error: 'The return needs a UTR before it can be filed.' }, { status: 400 });

  // Build → IRmark → envelope.
  const { base64: irmark, body } = markIrEnvelope(built.irEnvelope);
  const envelope = buildSubmissionEnvelope(body, built.utr, saCreds);
  const isTest = saGatewayTestFlag() === '1';

  // Submit, then poll while the gateway is still processing.
  let result: SaGatewayResult = await submitToGateway(envelope);
  const correlationId = result.correlationId;
  const endpoint = result.pollEndpoint ?? undefined;
  if (result.status === 'submitted' && correlationId) {
    const deadline = Date.now() + 48_000; // stay within maxDuration
    while (Date.now() < deadline) {
      const wait = Math.min(Math.max(result.pollSeconds ?? 10, 2), 20) * 1000;
      if (Date.now() + wait > deadline) break;
      await sleep(wait);
      result = await pollGateway(correlationId, endpoint, saCreds);
      if (result.status !== 'submitted') break; // accepted / rejected / error
    }
  }

  // On a final acceptance, clear the correlation from HMRC's queue.
  if (result.status === 'accepted' && (result.correlationId || correlationId)) {
    await deleteFromGateway((result.correlationId || correlationId)!, endpoint, saCreds).catch(() => { /* best-effort */ });
  }

  // Record the attempt (any outcome).
  const finalStatus = result.status === 'submitted' ? 'pending' : result.status;
  await service.from('tax_studio_sa_submissions').insert({
    firm_id: ctx.firmId,
    return_id: params.id,
    client_id: clientId,
    tax_year: (data.taxYear as string) ?? null,
    utr: built.utr,
    irmark,
    correlation_id: result.correlationId ?? correlationId ?? null,
    is_test: isTest,
    gateway_status: finalStatus,
    gateway_message: result.message,
    hmrc_response: result.raw?.slice(0, 20_000) ?? null,
    submitted_by: ctx.userId,
  });

  if (result.status === 'rejected' || result.status === 'error') {
    return NextResponse.json({ error: result.message, gatewayStatus: result.status, isTest }, { status: 502 });
  }

  // Accepted (or still pending after the poll budget) — mark submitted on accept.
  const nowIso = new Date().toISOString();
  if (result.status === 'accepted') {
    const nextData = { ...data, approvalStatus: 'submitted', submittedAt: nowIso, submissionRef: irmark };
    await service.from('tax_studio_returns').update({ data: nextData, updated_at: nowIso })
      .eq('id', params.id).eq('firm_id', ctx.firmId);
    await logTaxAudit({
      firmId: ctx.firmId, returnId: params.id, clientId,
      clientName: (data.clientName as string) ?? null, actorId: ctx.userId,
      action: 'submitted',
      summary: `Filed SA100 to HMRC${isTest ? ' (TPVS test)' : ''} — IRmark ${irmark}`,
    });
  }

  return NextResponse.json({
    ok: true,
    gatewayStatus: finalStatus,
    accepted: result.status === 'accepted',
    pending: result.status === 'submitted',
    irmark,
    correlationId: result.correlationId ?? correlationId ?? null,
    message: result.message,
    isTest,
    submittedAt: nowIso,
  });
}
