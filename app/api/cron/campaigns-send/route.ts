import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase-server';
import { runCampaignSend, continueCampaignSend } from '@/lib/campaigns/runSend';

// ─── /api/cron/campaigns-send ──────────────────────────────────────────────
// Sends campaigns whose scheduled time has arrived. Each scheduled campaign is
// sent over its author's connected Gmail (created_by → email_connections). Runs
// every 15 minutes; the 'sending'/'sent' status guard in runCampaignSend keeps a
// double-fire from sending twice.

export const maxDuration = 300;

function isAuthorisedCron(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.warn('[campaigns-send] CRON_SECRET not set — allowing request.');
    return true;
  }
  return request.headers.get('authorization') === `Bearer ${secret}`;
}

export async function GET(request: Request) {
  if (!isAuthorisedCron(request)) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const service = createServiceClient();
  const nowIso = new Date().toISOString();

  const { data: due } = await service
    .from('campaigns')
    .select('*')
    .eq('status', 'scheduled')
    .lte('scheduled_at', nowIso)
    .limit(20);

  const results: { id: string; sent?: number; failed?: number; error?: string }[] = [];

  for (const campaign of (due ?? [])) {
    try {
      if (!campaign.created_by) { results.push({ id: campaign.id, error: 'No author to send as.' }); continue; }
      const { data: conn } = await service
        .from('email_connections').select('refresh_token, google_email').eq('user_id', campaign.created_by).maybeSingle();
      if (!conn?.refresh_token) {
        await service.from('campaigns').update({ status: 'failed', updated_at: nowIso }).eq('id', campaign.id);
        results.push({ id: campaign.id, error: 'Author has no connected Gmail.' });
        continue;
      }
      const res = await runCampaignSend({
        service, read: service, firmId: campaign.firm_id, campaign,
        senderEmail: conn.google_email, senderRefreshToken: conn.refresh_token,
      });
      results.push(res.ok ? { id: campaign.id, sent: res.sent, failed: res.failed } : { id: campaign.id, error: res.error });
    } catch (err) {
      console.error('[campaigns-send]', campaign.id, err);
      results.push({ id: campaign.id, error: 'Unexpected error' });
    }
  }

  // ── Resume part-sent campaigns whose next daily batch is due ────────────────
  const { data: batching } = await service
    .from('campaigns')
    .select('*')
    .eq('status', 'sending')
    .lte('next_batch_at', nowIso)
    .limit(10);

  for (const campaign of (batching ?? [])) {
    try {
      if (!campaign.created_by) continue;
      const { data: conn } = await service
        .from('email_connections').select('refresh_token, google_email').eq('user_id', campaign.created_by).maybeSingle();
      if (!conn?.refresh_token) continue;
      const res = await continueCampaignSend({
        service, read: service, firmId: campaign.firm_id, campaign,
        senderEmail: conn.google_email, senderRefreshToken: conn.refresh_token,
      });
      results.push(res.ok
        ? { id: campaign.id, sent: res.sent, failed: res.failed }
        : { id: campaign.id, error: res.error });
    } catch (err) {
      console.error('[campaigns-send] batch resume', campaign.id, err);
    }
  }

  return NextResponse.json({ processed: results.length, results });
}
