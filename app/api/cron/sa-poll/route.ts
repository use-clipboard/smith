import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase-server';
import { logTaxAudit } from '@/lib/tax-studio/audit';
import { pollGateway, deleteFromGateway } from '@/lib/hmrc-sa/gateway';
import { isSaFilingConfigured } from '@/lib/hmrc-sa/config';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

// Cron — resolve legacy SA100 submissions that were still 'pending' when the
// submit request's in-request poll ran out of time. Polls the gateway for each
// one and, on a final acceptance, records the receipt + marks the return filed.
// (Single-firm: polls with the env Government-Gateway creds. Multi-firm would
// need per-firm creds — TODO with per-firm cred storage.)
function isAuthorisedCron(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) { console.warn('[SA poll cron] CRON_SECRET not set — allowing through.'); return true; }
  return request.headers.get('authorization') === `Bearer ${secret}`;
}

export async function GET(request: Request) {
  if (!isAuthorisedCron(request)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  if (!isSaFilingConfigured()) return NextResponse.json({ skipped: 'SA filing not configured' });

  const service = createServiceClient();
  // Pending submissions from the last 7 days that still carry a correlation id.
  const since = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
  const { data: rows } = await service
    .from('tax_studio_sa_submissions')
    .select('id, firm_id, return_id, client_id, correlation_id, irmark')
    .eq('gateway_status', 'pending')
    .not('correlation_id', 'is', null)
    .gte('submitted_at', since)
    .limit(50);

  let accepted = 0, rejected = 0, stillPending = 0;
  for (const row of rows ?? []) {
    const result = await pollGateway(row.correlation_id as string);
    if (result.status === 'submitted') { stillPending++; continue; } // not resolved yet

    // Update the receipt with the final outcome.
    await service.from('tax_studio_sa_submissions')
      .update({ gateway_status: result.status, gateway_message: result.message, hmrc_response: result.raw?.slice(0, 20_000) ?? null })
      .eq('id', row.id);

    if (result.status === 'accepted') {
      accepted++;
      await deleteFromGateway(row.correlation_id as string).catch(() => { /* best-effort */ });
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
            action: 'submitted', summary: `SA100 accepted by HMRC (poll) — IRmark ${row.irmark}`,
          });
        }
      }
    } else {
      rejected++;
    }
  }

  return NextResponse.json({ ok: true, checked: rows?.length ?? 0, accepted, rejected, stillPending });
}
