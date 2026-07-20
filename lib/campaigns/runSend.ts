// Shared campaign send routine — used by the interactive send route
// (app/api/campaigns/[id]/send), the scheduled-send cron, and the automations
// runner. Keeping delivery in one place means every path behaves identically:
// same tracking, same recipient rows, same stats.

import type { SupabaseClient } from '@supabase/supabase-js';
import { getRefreshedGmailClient, buildRawMessage, gmailRetry, mapWithConcurrency } from '@/lib/gmail';
import { wrapBodyFont } from '@/lib/emailFonts';
import { getFirmEmailFont } from '@/lib/emailFirmSettings';
import { resolveAudience } from '@/lib/campaigns/audience';
import { resolveCampaignMergeTags } from '@/lib/campaigns/mergeFields';
import { instrumentHtml } from '@/lib/campaigns/tracking';
import { getCampaignFirmSettings } from '@/lib/campaigns/settings';
import type { ResolvedRecipient, CampaignSettings } from '@/types/campaigns';

export const MAX_PERSONAL_SEND = 450;
const SEND_CONCURRENCY = 4;

/** Split a resolved audience into what we'll send vs record-but-skip. */
export function splitResolved(resolved: ResolvedRecipient[], dedupe: 'per_email' | 'per_client') {
  const sendable: ResolvedRecipient[] = [];
  const skipped: { r: ResolvedRecipient; status: string }[] = [];
  for (const r of resolved) {
    if (r.excludedReason === 'no_email') { skipped.push({ r, status: 'skipped' }); continue; }
    if (r.excludedReason === 'unsubscribed') { skipped.push({ r, status: 'unsubscribed' }); continue; }
    if (r.excludedReason === 'duplicate' && dedupe === 'per_email') { skipped.push({ r, status: 'skipped' }); continue; }
    sendable.push(r);
  }
  return { sendable, skipped };
}

export interface DeliverParams {
  service: SupabaseClient;            // service-role — writes recipients/events/campaign
  read: SupabaseClient;               // firm-scoped read (font)
  firmId: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  campaign: any;                      // campaigns row (must already exist)
  senderEmail: string;
  senderRefreshToken: string;
  sendable: ResolvedRecipient[];
  skipped: { r: ResolvedRecipient; status: string }[];
  includeUnsubscribe?: boolean;
}

export type SendResult =
  | { ok: true; sent: number; failed: number; recipients: number }
  | { ok: false; status: number; error: string };

/**
 * Deliver a campaign to an already-resolved recipient list: freeze the rows,
 * personalise + instrument each, send over Gmail, update stats.
 */
export async function deliverCampaign(p: DeliverParams): Promise<SendResult> {
  const { service, read, firmId, campaign, senderEmail, senderRefreshToken, sendable, skipped } = p;
  const fs = await getCampaignFirmSettings(read, firmId);
  const includeUnsubscribe = p.includeUnsubscribe ?? fs.include_unsubscribe;
  const replyTo = campaign.reply_to || fs.reply_to || undefined;

  if (sendable.length === 0) return { ok: false, status: 400, error: 'No sendable recipients.' };
  if (sendable.length > MAX_PERSONAL_SEND) {
    return { ok: false, status: 400, error: `${sendable.length} recipients — over the ${MAX_PERSONAL_SEND} limit for sending from Gmail. Narrow the audience or split the send.` };
  }

  const rows = [
    ...sendable.map(r => ({ campaign_id: campaign.id, firm_id: firmId, client_id: r.client_id, email: r.email, name: r.name, merge_data: r.merge_data, status: 'pending' })),
    ...skipped.map(({ r, status }) => ({ campaign_id: campaign.id, firm_id: firmId, client_id: r.client_id, email: r.email, name: r.name, merge_data: r.merge_data, status })),
  ];
  const { data: inserted, error: insErr } = await service.from('campaign_recipients').insert(rows).select('id, email, merge_data, status');
  if (insErr || !inserted) return { ok: false, status: 500, error: 'Failed to prepare the recipient list.' };
  const pending = inserted.filter(r => r.status === 'pending');

  await service.from('campaigns').update({ status: 'sending', from_email: senderEmail, updated_at: new Date().toISOString() }).eq('id', campaign.id);

  const font = campaign.body_font || await getFirmEmailFont(read, firmId);

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
      await service.from('campaign_recipients').update({ status: 'sent', message_id: res.data.id ?? null, thread_id: res.data.threadId ?? null, sent_at: new Date().toISOString() }).eq('id', rcpt.id as string);
      await service.from('campaign_events').insert({ firm_id: firmId, campaign_id: campaign.id, recipient_id: rcpt.id as string, type: 'send' });
      sent++;
    } catch (err) {
      const msg = err instanceof Error ? err.message.slice(0, 300) : 'Send failed';
      await service.from('campaign_recipients').update({ status: 'failed', error: msg }).eq('id', rcpt.id as string);
      await service.from('campaign_events').insert({ firm_id: firmId, campaign_id: campaign.id, recipient_id: rcpt.id as string, type: 'fail' });
      failed++;
    }
  });

  const stats = {
    recipients: rows.length, sent, failed, delivered: sent, bounced: 0, opened: 0, clicked: 0,
    unsubscribed: skipped.filter(s => s.status === 'unsubscribed').length,
  };
  await service.from('campaigns').update({
    status: sent > 0 ? 'sent' : 'failed', sent_at: new Date().toISOString(), stats, updated_at: new Date().toISOString(),
  }).eq('id', campaign.id);

  return { ok: true, sent, failed, recipients: rows.length };
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

/** Validate a campaign, resolve its saved audience, and deliver it. */
export async function runCampaignSend(p: RunSendParams): Promise<SendResult> {
  const { service, read, firmId, campaign, senderEmail, senderRefreshToken } = p;

  if (campaign.status === 'sending' || campaign.status === 'sent') return { ok: false, status: 409, error: 'This campaign has already been sent.' };
  if (!campaign.subject?.trim() || !campaign.body_html?.trim()) return { ok: false, status: 400, error: 'Add a subject and body before sending.' };
  if (!campaign.audience_id) return { ok: false, status: 400, error: 'Choose an audience before sending.' };

  const { data: audience } = await read.from('campaign_audiences').select('*').eq('id', campaign.audience_id).eq('firm_id', firmId).maybeSingle();
  if (!audience) return { ok: false, status: 400, error: 'The selected audience no longer exists.' };

  let resolved: ResolvedRecipient[];
  try {
    resolved = await resolveAudience(read, firmId, { source: audience.source, definition: audience.definition, member_client_ids: audience.member_client_ids });
  } catch {
    return { ok: false, status: 500, error: 'Failed to resolve the audience.' };
  }

  const settings = (campaign.settings ?? {}) as CampaignSettings;
  const fs = await getCampaignFirmSettings(read, firmId);
  const { sendable, skipped } = splitResolved(resolved, settings.dedupe ?? fs.default_dedupe);

  // Governance: block an unapproved send once the firm requires review. Checked
  // against the real recipient count so the threshold means what it says, and
  // against approved_at (not status) so it survives scheduling.
  if (fs.require_approval && sendable.length >= (fs.approval_min_recipients || 0) && !campaign.approved_at) {
    return {
      ok: false, status: 403,
      error: `This campaign needs approval before it can be sent (${sendable.length} recipients).`,
    };
  }

  await service.from('campaigns').update({
    audience_snapshot: { source: audience.source, definition: audience.definition, resolved: resolved.length },
  }).eq('id', campaign.id);

  return deliverCampaign({
    service, read, firmId, campaign, senderEmail, senderRefreshToken,
    sendable, skipped, includeUnsubscribe: settings.includeUnsubscribe,
  });
}
