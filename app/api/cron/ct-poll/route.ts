import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase-server';
import { logTaxAudit } from '@/lib/tax-studio/audit';
import { pollGateway, deleteFromGateway } from '@/lib/hmrc-ct/gateway';
import { resolveCtCreds } from '@/lib/hmrc-ct/getCtCredsForFirm';
import type { CtCreds } from '@/lib/hmrc-ct/config';
import { isAuthorisedCron } from '@/lib/cronAuth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

// Cron — resolve CT600 submissions that were still 'pending' when the submit
// request's in-request poll ran out of time. Polls the gateway for each and, on a
// final acceptance, records the receipt + marks the return filed. Credentials are
// resolved per submission's firm (firm store → env fallback); a submission whose
// firm has no usable creds is left pending for a later run.

export async function GET(request: Request) {
  if (!isAuthorisedCron(request)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const service = createServiceClient();
  const credsCache = new Map<string, CtCreds | null>();
  async function credsFor(firmId: string): Promise<CtCreds | null> {
    if (credsCache.has(firmId)) return credsCache.get(firmId)!;
    let creds: CtCreds | null = null;
    try {
      const resolved = await resolveCtCreds(firmId);
      creds = resolved ? { senderId: resolved.senderId, password: resolved.password, vendorId: resolved.vendorId } : null;
    } catch { creds = null; }
    credsCache.set(firmId, creds);
    return creds;
  }
  const since = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
  const { data: rows } = await service
    .from('tax_studio_ct_submissions')
    .select('id, firm_id, return_id, client_id, correlation_id, irmark')
    .eq('gateway_status', 'pending')
    .not('correlation_id', 'is', null)
    .gte('submitted_at', since)
    .limit(50);

  let accepted = 0, rejected = 0, stillPending = 0, skippedNoCreds = 0;
  for (const row of rows ?? []) {
    const creds = await credsFor(row.firm_id as string);
    if (!creds) { skippedNoCreds++; continue; }
    const result = await pollGateway(row.correlation_id as string, undefined, creds);
    if (result.status === 'submitted') { stillPending++; continue; }

    await service.from('tax_studio_ct_submissions')
      .update({ gateway_status: result.status, gateway_message: result.message, hmrc_response: result.raw?.slice(0, 20_000) ?? null })
      .eq('id', row.id);

    if (result.status === 'accepted') {
      accepted++;
      await deleteFromGateway(row.correlation_id as string, undefined, creds).catch(() => { /* best-effort */ });
      if (row.return_id) {
        const { data: rt } = await service.from('tax_studio_returns').select('data').eq('id', row.return_id).eq('firm_id', row.firm_id).single();
        const data = (rt?.data ?? {}) as Record<string, unknown>;
        if (data && data.approvalStatus !== 'submitted') {
          const nowIso = new Date().toISOString();
          await service.from('tax_studio_returns')
            .update({ data: { ...data, approvalStatus: 'submitted', submittedAt: nowIso, submissionRef: row.irmark }, updated_at: nowIso })
            .eq('id', row.return_id).eq('firm_id', row.firm_id);
          await logTaxAudit({
            firmId: row.firm_id as string, returnId: row.return_id as string, clientId: (row.client_id as string) ?? null,
            clientName: (data.clientName as string) ?? null, actorId: null,
            action: 'submitted', summary: `CT600 accepted by HMRC (poll) — IRmark ${row.irmark}`,
          });
        }
      }
    } else {
      rejected++;
    }
  }

  return NextResponse.json({ ok: true, checked: rows?.length ?? 0, accepted, rejected, stillPending, skippedNoCreds });
}
