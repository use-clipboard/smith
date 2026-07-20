// Shared campaign send routine — used by the interactive send route
// (app/api/campaigns/[id]/send), the scheduled-send cron, the batch-resume cron
// and the automations runner. Keeping delivery in one place means every path
// behaves identically: same tracking, same recipient rows, same stats.
//
// Large audiences are not refused. The whole recipient list is frozen up front
// and sent in daily batches (Gmail caps per-mailbox volume), with the campaign
// parked in 'sending' and `next_batch_at` marking when the next slice may go.

import type { SupabaseClient } from '@supabase/supabase-js';
import { getRefreshedGmailClient, buildRawMessage, gmailRetry, mapWithConcurrency } from '@/lib/gmail';
import { wrapBodyFont } from '@/lib/emailFonts';
import { getFirmEmailFont } from '@/lib/emailFirmSettings';
import { resolveAudience, applyFrequencyGuard } from '@/lib/campaigns/audience';
import { resolveCampaignMergeTags } from '@/lib/campaigns/mergeFields';
import { instrumentHtml } from '@/lib/campaigns/tracking';
import { getCampaignFirmSettings } from '@/lib/campaigns/settings';
import type { ResolvedRecipient, CampaignSettings, CampaignFirmSettings } from '@/types/campaigns';

/** Most emails one mailbox sends per batch. Gmail allows ~500/day (consumer)
 *  and ~2,000 (Workspace); we stay well under the lower bound. */
export const MAX_PER_BATCH = 450;
const SEND_CONCURRENCY = 4;
const BATCH_INTERVAL_MS = 24 * 60 * 60 * 1000;

/** Split a resolved audience into what we'll send vs record-but-skip. */
export function splitResolved(resolved: ResolvedRecipient[], dedupe: 'per_email' | 'per_client') {
  const sendable: ResolvedRecipient[] = [];
  const skipped: { r: ResolvedRecipient; status: string }[] = [];
  for (const r of resolved) {
    if (r.excludedReason === 'no_email') { skipped.push({ r, status: 'skipped' }); continue; }
    if (r.excludedReason === 'unsubscribed') { skipped.push({ r, status: 'unsubscribed' }); continue; }
    if (r.excludedReason === 'too_recent') { skipped.push({ r, status: 'skipped' }); continue; }
    if (r.excludedReason === 'duplicate' && dedupe === 'per_email') { skipped.push({ r, status: 'skipped' }); continue; }
    sendable.push(r);
  }
  return { sendable, skipped };
}

export type SendResult =
  | { ok: true; sent: number; failed: number; recipients: number; remaining: number }
  | { ok: false; status: number; error: string };

interface BatchCtx {
  service: SupabaseClient;
  read: SupabaseClient;
  firmId: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  campaign: any;
  senderEmail: string;
  senderRefreshToken: string;
  fs: CampaignFirmSettings;
}

/** Recompute the campaign's headline counters straight from its recipient rows
 *  (a batched send can't just accumulate in memory). */
async function recomputeStats(service: SupabaseClient, campaignId: string) {
  const { data } = await service
    .from('campaign_recipients')
    .select('status, opened_at, first_clicked_at, replied_at, bounced_at, unsubscribed_at')
    .eq('campaign_id', campaignId);
  const rows = data ?? [];
  const stats = {
    recipients: rows.length,
    sent: rows.filter(r => ['sent', 'delivered', 'bounced'].includes(r.status as string)).length,
    delivered: rows.filter(r => ['sent', 'delivered'].includes(r.status as string)).length,
    failed: rows.filter(r => r.status === 'failed').length,
    pending: rows.filter(r => r.status === 'pending').length,
    bounced: rows.filter(r => r.bounced_at).length,
    opened: rows.filter(r => r.opened_at).length,
    clicked: rows.filter(r => r.first_clicked_at).length,
    replied: rows.filter(r => r.replied_at).length,
    unsubscribed: rows.filter(r => r.unsubscribed_at).length,
  };
  await service.from('campaigns').update({ stats }).eq('id', campaignId);
  return stats;
}

/**
 * Send the next batch of this campaign's pending recipients. Safe to call
 * repeatedly — it simply picks up whatever is still pending.
 */
export async function sendPendingBatch(ctx: BatchCtx): Promise<SendResult> {
  const { service, read, firmId, campaign, senderEmail, senderRefreshToken, fs } = ctx;

  const { data: pending } = await service
    .from('campaign_recipients')
    .select('id, email, merge_data')
    .eq('campaign_id', campaign.id)
    .eq('status', 'pending')
    .limit(MAX_PER_BATCH);

  if (!pending?.length) {
    const stats = await recomputeStats(service, campaign.id);
    await service.from('campaigns').update({
      status: stats.sent > 0 ? 'sent' : 'failed',
      sent_at: campaign.sent_at ?? new Date().toISOString(),
      next_batch_at: null,
      updated_at: new Date().toISOString(),
    }).eq('id', campaign.id);
    return { ok: true, sent: 0, failed: 0, recipients: stats.recipients, remaining: 0 };
  }

  await service.from('campaigns').update({ status: 'sending', from_email: senderEmail, updated_at: new Date().toISOString() }).eq('id', campaign.id);

  const font = campaign.body_font || await getFirmEmailFont(read, firmId);
  const includeUnsubscribe = ((campaign.settings ?? {}) as CampaignSettings).includeUnsubscribe ?? fs.include_unsubscribe;
  const replyTo = campaign.reply_to || fs.reply_to || undefined;

  let gmail: Awaited<ReturnType<typeof getRefreshedGmailClient>>['gmail'];
  try {
    ({ gmail } = await getRefreshedGmailClient(senderRefreshToken));
  } catch {
    await service.from('campaigns').update({ status: 'failed', updated_at: new Date().toISOString() }).eq('id', campaign.id);
    return { ok: false, status: 500, error: 'Could not authenticate with Gmail. Reconnect it.' };
  }

  let sent = 0, failed = 0;
  await mapWithConcurrency(pending, SEND_CONCURRENCY, async (rcpt) => {
    const mergeData = (rcpt.merge_data ?? {}) as Record<string, string>;
    try {
      const subject = resolveCampaignMergeTags(campaign.subject, mergeData) || '(no subject)';
      const body = resolveCampaignMergeTags(campaign.body_html, mergeData);
      const instrumented = instrumentHtml(body, rcpt.id as string, { unsubscribe: includeUnsubscribe, footerText: fs.unsubscribe_footer });
      const raw = buildRawMessage({ from: senderEmail, to: [rcpt.email as string], subject, htmlBody: wrapBodyFont(instrumented, font), replyTo });
      const res = await gmailRetry(() => gmail.users.messages.send({ userId: 'me', requestBody: { raw } }));
      await service.from('campaign_recipients').update({
        status: 'sent', message_id: res.data.id ?? null, thread_id: res.data.threadId ?? null, sent_at: new Date().toISOString(),
      }).eq('id', rcpt.id as string);
      await service.from('campaign_events').insert({ firm_id: firmId, campaign_id: campaign.id, recipient_id: rcpt.id as string, type: 'send' });
      sent++;
    } catch (err) {
      const msg = err instanceof Error ? err.message.slice(0, 300) : 'Send failed';
      await service.from('campaign_recipients').update({ status: 'failed', error: msg }).eq('id', rcpt.id as string);
      await service.from('campaign_events').insert({ firm_id: firmId, campaign_id: campaign.id, recipient_id: rcpt.id as string, type: 'fail' });
      failed++;
    }
  });

  const stats = await recomputeStats(service, campaign.id);
  const remaining = stats.pending;
  const now = new Date();

  await service.from('campaigns').update({
    // Stay in 'sending' while more batches are queued; the campaigns-send cron
    // resumes once next_batch_at passes.
    status: remaining > 0 ? 'sending' : (stats.sent > 0 ? 'sent' : 'failed'),
    next_batch_at: remaining > 0 ? new Date(now.getTime() + BATCH_INTERVAL_MS).toISOString() : null,
    sent_at: campaign.sent_at ?? now.toISOString(),
    updated_at: now.toISOString(),
  }).eq('id', campaign.id);

  return { ok: true, sent, failed, recipients: stats.recipients, remaining };
}

export interface RunSendParams {
  service: SupabaseClient;
  read: SupabaseClient;
  firmId: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  campaign: any;
  senderEmail: string;
  senderRefreshToken: string;
}

/** Validate a campaign, freeze its recipient list, and send the first batch. */
export async function runCampaignSend(p: RunSendParams): Promise<SendResult> {
  const { service, read, firmId, campaign, senderEmail, senderRefreshToken } = p;

  if (campaign.status === 'sending' || campaign.status === 'sent') return { ok: false, status: 409, error: 'This campaign has already been sent.' };
  if (!campaign.subject?.trim() || !campaign.body_html?.trim()) return { ok: false, status: 400, error: 'Add a subject and body before sending.' };
  if (!campaign.audience_id) return { ok: false, status: 400, error: 'Choose an audience before sending.' };

  const { data: audience } = await read.from('campaign_audiences').select('*').eq('id', campaign.audience_id).eq('firm_id', firmId).maybeSingle();
  if (!audience) return { ok: false, status: 400, error: 'The selected audience no longer exists.' };

  const fs = await getCampaignFirmSettings(read, firmId);

  let resolved: ResolvedRecipient[];
  try {
    resolved = await resolveAudience(read, firmId, { source: audience.source, definition: audience.definition, member_client_ids: audience.member_client_ids });
    await applyFrequencyGuard(read, firmId, resolved, fs.frequency_guard_days);
  } catch {
    return { ok: false, status: 500, error: 'Failed to resolve the audience.' };
  }

  const settings = (campaign.settings ?? {}) as CampaignSettings;
  const { sendable, skipped } = splitResolved(resolved, settings.dedupe ?? fs.default_dedupe);

  if (sendable.length === 0) return { ok: false, status: 400, error: 'No sendable recipients in this audience.' };

  // Governance: block an unapproved send once the firm requires review. Checked
  // against the real recipient count so the threshold means what it says, and
  // against approved_at (not status) so it survives scheduling.
  if (fs.require_approval && sendable.length >= (fs.approval_min_recipients || 0) && !campaign.approved_at) {
    return {
      ok: false, status: 403,
      error: `This campaign needs approval before it can be sent (${sendable.length} recipients).`,
    };
  }

  // Freeze the whole list up front, then send it a batch at a time.
  const rows = [
    ...sendable.map(r => ({ campaign_id: campaign.id, firm_id: firmId, client_id: r.client_id, email: r.email, name: r.name, merge_data: r.merge_data, status: 'pending' })),
    ...skipped.map(({ r, status }) => ({ campaign_id: campaign.id, firm_id: firmId, client_id: r.client_id, email: r.email, name: r.name, merge_data: r.merge_data, status })),
  ];
  const { error: insErr } = await service.from('campaign_recipients').insert(rows);
  if (insErr) return { ok: false, status: 500, error: 'Failed to prepare the recipient list.' };

  await service.from('campaigns').update({
    audience_snapshot: { source: audience.source, definition: audience.definition, resolved: resolved.length },
  }).eq('id', campaign.id);

  return sendPendingBatch({ service, read, firmId, campaign, senderEmail, senderRefreshToken, fs });
}

/** Resume a part-sent campaign (called by the cron when next_batch_at passes). */
export async function continueCampaignSend(p: RunSendParams): Promise<SendResult> {
  const fs = await getCampaignFirmSettings(p.read, p.firmId);
  return sendPendingBatch({ ...p, fs });
}

/**
 * Deliver a pre-resolved recipient list under an existing campaign. Used by the
 * journey engine, which supplies its own recipients rather than an audience.
 */
export async function deliverCampaign(p: RunSendParams & {
  sendable: ResolvedRecipient[];
  skipped: { r: ResolvedRecipient; status: string }[];
  includeUnsubscribe?: boolean;
}): Promise<SendResult> {
  const { service, read, firmId, campaign, sendable, skipped } = p;
  if (sendable.length === 0) return { ok: false, status: 400, error: 'No sendable recipients.' };

  const fs = await getCampaignFirmSettings(read, firmId);
  const rows = [
    ...sendable.map(r => ({ campaign_id: campaign.id, firm_id: firmId, client_id: r.client_id, email: r.email, name: r.name, merge_data: r.merge_data, status: 'pending' })),
    ...skipped.map(({ r, status }) => ({ campaign_id: campaign.id, firm_id: firmId, client_id: r.client_id, email: r.email, name: r.name, merge_data: r.merge_data, status })),
  ];
  const { error: insErr } = await service.from('campaign_recipients').insert(rows);
  if (insErr) return { ok: false, status: 500, error: 'Failed to prepare the recipient list.' };

  return sendPendingBatch({
    service, read, firmId, campaign,
    senderEmail: p.senderEmail, senderRefreshToken: p.senderRefreshToken,
    fs: p.includeUnsubscribe === undefined ? fs : { ...fs, include_unsubscribe: p.includeUnsubscribe },
  });
}
