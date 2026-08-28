import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';
import { canAccessTaxStudio } from '@/lib/tax-studio/access';
import { logTaxAudit } from '@/lib/tax-studio/audit';
import type { TaxReturn } from '@/components/features/tax-studio/types';
import { buildCt600Return } from '@/lib/hmrc-ct/ct600Return';
import { markIrEnvelope } from '@/lib/hmrc-ct/irmark';
import { buildSubmissionEnvelope, submitToGateway, pollGateway, deleteFromGateway, type CtGatewayResult } from '@/lib/hmrc-ct/gateway';
import { ctGatewayTestFlag, type CtCreds } from '@/lib/hmrc-ct/config';
import { getCtCredsForFirm, CtFilingNotConfiguredError } from '@/lib/hmrc-ct/getCtCredsForFirm';
import { buildIxbrlFromEngagement } from '@/lib/accounts-studio/ixbrlFromEngagement';
import { ddmmyyyyToIso } from '@/lib/accounts-studio/ixbrl';
import { getAccountsStudioFirmSettings } from '@/lib/accounts-studio/firmSettings';
import type { Engagement } from '@/components/features/accounts-studio/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Find the Accounts Studio engagement whose accounting period matches the CT600
 *  period end, and build its statutory-accounts iXBRL — so HMRC receives the SAME
 *  accounts SMITH prepared. Returns null when no matching engagement exists. */
async function sourceAccountsIxbrl(
  supabase: ReturnType<typeof createClient>, firmId: string, clientId: string | null, periodEndIso: string | null,
): Promise<string | null> {
  if (!clientId || !periodEndIso) return null;
  const { data } = await supabase
    .from('accounts_studio_engagements')
    .select('id, client_id, data')
    .eq('firm_id', firmId).eq('client_id', clientId);
  const rows = (data ?? []) as { id: string; client_id: string | null; data: Engagement }[];
  const match = rows.find(r => {
    const e = r.data;
    const endIso = e?.importInfo?.to ?? (e?.periodEnd ? ddmmyyyyToIso(e.periodEnd) : null);
    return endIso === periodEndIso;
  });
  if (!match) return null;
  const e = { ...match.data, id: match.id };
  let hasAccountantsReport = false;
  try {
    const settings = await getAccountsStudioFirmSettings(supabase, firmId);
    hasAccountantsReport = !!(settings?.accountantsReport && settings.accountantsReport.trim());
  } catch { /* default: no accountant's report */ }
  return buildIxbrlFromEngagement(e, { hasAccountantsReport });
}

// POST /api/tax-studio/returns/[id]/ct-submit
// Files the CT600 to HMRC's Corporation Tax Online service: sources the statutory
// accounts iXBRL from the matching Accounts Studio engagement, builds the CT600
// XML (with the computation + accounts iXBRL embedded) → IRmarks it → wraps in the
// GovTalk envelope → submits, then polls for the outcome (bounded in-request; a
// cron fallback covers slow responses), records a receipt and — on acceptance —
// marks the return submitted.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  if (!canAccessTaxStudio(ctx.activeModules)) return NextResponse.json({ error: 'Tax Studio is not available for your account.' }, { status: 403 });

  // Resolve the firm's Government Gateway credentials (firm store → env fallback).
  let ctCreds: CtCreds;
  try {
    ctCreds = await getCtCredsForFirm(ctx.firmId);
  } catch (e) {
    if (e instanceof CtFilingNotConfiguredError) return NextResponse.json({ error: e.message }, { status: 400 });
    throw e;
  }

  const supabase = createClient();
  const service = createServiceClient();
  const { data: row } = await service
    .from('tax_studio_returns').select('id, data').eq('id', params.id).eq('firm_id', ctx.firmId).single();
  if (!row) return NextResponse.json({ error: 'Return not found.' }, { status: 404 });

  const data = (row.data ?? {}) as Record<string, unknown>;
  const ret = data as unknown as TaxReturn;
  const clientId = (data.clientId as string | null) ?? null;

  if (ret.returnType !== 'ct600') return NextResponse.json({ error: 'This return is not a CT600.' }, { status: 400 });

  // Pre-submission validation gate — HMRC rejects a CT600 missing its identity.
  const missing: string[] = [];
  if (!ret.utr) missing.push('CT UTR');
  if (!ret.companyRegNumber) missing.push('company registration number');
  if (!ret.periodStart || !ret.periodEnd) missing.push('accounting period');
  if (missing.length) return NextResponse.json({ error: `The return needs its ${missing.join(', ')} before it can be filed.` }, { status: 400 });

  const isTest = ctGatewayTestFlag() === '1';

  // Source the statutory-accounts iXBRL from the matching engagement. Required for
  // a real filing; on the test service we allow a computation-only submission so
  // the pipeline can be exercised before the accounts are prepared.
  const accountsIxbrl = await sourceAccountsIxbrl(supabase, ctx.firmId, clientId, ret.periodEnd ?? null);
  if (!accountsIxbrl && !isTest) {
    return NextResponse.json({ error: 'No matching Accounts Studio accounts were found for this period. Prepare and approve the statutory accounts before filing the CT600.' }, { status: 400 });
  }

  const built = buildCt600Return(ret, { accountsIxbrl });
  if (!built.utr) return NextResponse.json({ error: 'The return needs a valid 10-digit UTR before it can be filed.' }, { status: 400 });

  // Build → IRmark → envelope.
  const { base64: irmark, body } = markIrEnvelope(built.irEnvelope);
  const envelope = buildSubmissionEnvelope(body, built.utr, ctCreds);

  // Submit, then poll while the gateway is still processing.
  let result: CtGatewayResult = await submitToGateway(envelope);
  const correlationId = result.correlationId;
  const endpoint = result.pollEndpoint ?? undefined;
  if (result.status === 'submitted' && correlationId) {
    const deadline = Date.now() + 48_000; // stay within maxDuration
    while (Date.now() < deadline) {
      const wait = Math.min(Math.max(result.pollSeconds ?? 10, 2), 20) * 1000;
      if (Date.now() + wait > deadline) break;
      await sleep(wait);
      result = await pollGateway(correlationId, endpoint, ctCreds);
      if (result.status !== 'submitted') break; // accepted / rejected / error
    }
  }

  // On a final acceptance, clear the correlation from HMRC's queue.
  if (result.status === 'accepted' && (result.correlationId || correlationId)) {
    await deleteFromGateway((result.correlationId || correlationId)!, endpoint, ctCreds).catch(() => { /* best-effort */ });
  }

  // Record the attempt (any outcome).
  const finalStatus = result.status === 'submitted' ? 'pending' : result.status;
  await service.from('tax_studio_ct_submissions').insert({
    firm_id: ctx.firmId,
    return_id: params.id,
    client_id: clientId,
    tax_year: (data.taxYear as string) ?? null,
    period_start: ret.periodStart ?? null,
    period_end: ret.periodEnd ?? null,
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
      summary: `Filed CT600 to HMRC${isTest ? ' (test)' : ''} — IRmark ${irmark}`,
    });
  }

  return NextResponse.json({
    ok: true,
    gatewayStatus: finalStatus,
    accepted: result.status === 'accepted',
    pending: result.status === 'submitted',
    accountsAttached: !!accountsIxbrl,
    irmark,
    correlationId: result.correlationId ?? correlationId ?? null,
    message: result.message,
    isTest,
    submittedAt: nowIso,
  });
}
