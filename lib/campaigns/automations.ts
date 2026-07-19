// Campaign automations — trigger metadata + the runner that fires one.
//
// Phase 1 model: a trigger + an email. When an automation is ACTIVE and fires,
// it delivers a real Campaign (so tracking + reports are uniform) to whoever
// currently matches:
//   • recurring  → the saved audience, on a monthly/weekly schedule
//   • event      → clients newly matching a practice condition, once per
//                  cooldown window (so they aren't re-emailed daily)
//
// Per-firing human approval (require_approval) is reserved for a later phase —
// the safety in Phase 1 is that automations default to PAUSED and only send
// once switched on.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { AudienceGroup, AutomationTriggerType } from '@/types/campaigns';
import { resolveAudience } from '@/lib/campaigns/audience';
import { splitResolved, deliverCampaign } from '@/lib/campaigns/runSend';
import { uidLike } from '@/lib/campaigns/ids';
import { TRIGGER_BY_TYPE } from '@/lib/campaigns/triggerMeta';

export { TRIGGERS, TRIGGER_BY_TYPE } from '@/lib/campaigns/triggerMeta';
export type { TriggerMeta } from '@/lib/campaigns/triggerMeta';

type TriggerType = AutomationTriggerType;

/** Build the synthetic audience definition for an event trigger. */
function triggerDefinition(type: TriggerType, days: number): AudienceGroup | null {
  const group = (field: string, operator: 'is_true' | 'within_days', value: string | number | boolean): AudienceGroup => ({
    id: uidLike(), kind: 'group', combinator: 'and', negate: false,
    children: [{ id: uidLike(), kind: 'rule', field, operator, value }],
  });
  switch (type) {
    case 'year_end_approaching':    return group('accounts_due_in_days', 'within_days', days);
    case 'cs_approaching':          return group('cs_due_in_days', 'within_days', days);
    case 'invoice_overdue':         return group('has_overdue_invoice', 'is_true', true);
    case 'mtd_quarter_outstanding': return group('mtd_quarter_outstanding', 'is_true', true);
    case 'task_overdue':            return group('has_overdue_task', 'is_true', true);
    default: return null;
  }
}

/** Next scheduled run for a recurring automation, strictly after `from`. */
export function computeNextRun(config: { frequency?: string; day?: number; hour?: number }, from: Date): Date {
  const hour = Math.min(23, Math.max(0, config.hour ?? 9));
  if (config.frequency === 'weekly') {
    // day = ISO weekday 1 (Mon) – 7 (Sun).
    const targetDow = Math.min(7, Math.max(1, config.day ?? 1));
    const d = new Date(from);
    d.setHours(hour, 0, 0, 0);
    const curDow = d.getDay() === 0 ? 7 : d.getDay();
    let add = targetDow - curDow;
    if (add < 0 || (add === 0 && d <= from)) add += 7;
    d.setDate(d.getDate() + add);
    return d;
  }
  // monthly: day of month 1–28 (clamped), at `hour`.
  const targetDom = Math.min(28, Math.max(1, config.day ?? 1));
  const d = new Date(from.getFullYear(), from.getMonth(), targetDom, hour, 0, 0, 0);
  if (d <= from) d.setMonth(d.getMonth() + 1);
  return d;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Automation = any; // campaign_automations row

export interface RunAutomationResult { fired: boolean; sent?: number; recipients?: number; reason?: string }

/**
 * Fire one automation now. Resolves the current recipients, applies the
 * per-client cooldown (event triggers), creates a Campaign and delivers it.
 * Idempotency for recurring is via next_run_at; for event triggers via the
 * campaign_automation_runs cooldown.
 */
export async function runAutomation(params: {
  service: SupabaseClient;
  automation: Automation;
  senderEmail: string;
  senderRefreshToken: string;
  now: Date;
}): Promise<RunAutomationResult> {
  const { service, automation, senderEmail, senderRefreshToken, now } = params;
  const meta = TRIGGER_BY_TYPE[automation.trigger_type];
  if (!meta) return { fired: false, reason: 'Unknown trigger' };

  const stampTimestamps = async (next?: Date | null) => {
    await service.from('campaign_automations').update({
      last_run_at: now.toISOString(),
      ...(next !== undefined ? { next_run_at: next ? next.toISOString() : null } : {}),
      updated_at: now.toISOString(),
    }).eq('id', automation.id);
  };

  // Resolve current recipients.
  let resolved;
  try {
    if (meta.recurring) {
      if (!automation.audience_id) { await stampTimestamps(computeNextRun(automation.trigger_config ?? {}, now)); return { fired: false, reason: 'No audience' }; }
      const { data: audience } = await service.from('campaign_audiences').select('*').eq('id', automation.audience_id).maybeSingle();
      if (!audience) { await stampTimestamps(computeNextRun(automation.trigger_config ?? {}, now)); return { fired: false, reason: 'Audience missing' }; }
      resolved = await resolveAudience(service, automation.firm_id, { source: audience.source, definition: audience.definition, member_client_ids: audience.member_client_ids });
    } else {
      const days = Number(automation.trigger_config?.days ?? meta.defaultDays ?? 30);
      const def = triggerDefinition(automation.trigger_type, days);
      resolved = await resolveAudience(service, automation.firm_id, { source: 'dynamic', definition: def ?? undefined });
    }
  } catch {
    return { fired: false, reason: 'Resolve failed' };
  }

  const { sendable, skipped } = splitResolved(resolved, 'per_email');

  // Cooldown filter for event triggers: drop clients we've emailed for this
  // automation within the cooldown window.
  let toSend = sendable;
  if (!meta.recurring && meta.cooldownDays > 0 && sendable.length > 0) {
    const since = new Date(now.getTime() - meta.cooldownDays * 86_400_000).toISOString();
    const { data: recent } = await service
      .from('campaign_automation_runs')
      .select('client_id')
      .eq('automation_id', automation.id)
      .gte('created_at', since);
    const cooled = new Set((recent ?? []).map(r => r.client_id as string));
    toSend = sendable.filter(r => !r.client_id || !cooled.has(r.client_id));
  }

  const nextRun = meta.recurring ? computeNextRun(automation.trigger_config ?? {}, now) : undefined;

  if (toSend.length === 0) {
    await stampTimestamps(nextRun);
    return { fired: false, reason: 'No new recipients' };
  }

  // Create the Campaign for this firing.
  const dateLabel = now.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  const { data: campaign, error: campErr } = await service.from('campaigns').insert({
    firm_id: automation.firm_id,
    name: `${automation.name} — ${dateLabel}`,
    subject: automation.subject,
    preview_text: automation.preview_text,
    body_html: automation.body_html,
    body_font: automation.body_font,
    from_email: senderEmail,
    reply_to: automation.reply_to,
    audience_id: meta.recurring ? automation.audience_id : null,
    status: 'draft',
    settings: { automation_id: automation.id, includeUnsubscribe: true },
    created_by: automation.created_by,
  }).select('*').single();
  if (campErr || !campaign) { await stampTimestamps(nextRun); return { fired: false, reason: 'Could not create campaign' }; }

  const result = await deliverCampaign({
    service, read: service, firmId: automation.firm_id, campaign, senderEmail, senderRefreshToken,
    sendable: toSend, skipped, includeUnsubscribe: true,
  });

  // Log per-client runs (for the event-trigger cooldown). One row per client.
  if (result.ok) {
    const runRows = toSend.filter(r => r.client_id).map(r => ({
      firm_id: automation.firm_id, automation_id: automation.id, client_id: r.client_id, email: r.email, campaign_id: campaign.id, status: 'sent',
    }));
    if (runRows.length) await service.from('campaign_automation_runs').insert(runRows);
  }

  await stampTimestamps(nextRun);
  return result.ok
    ? { fired: true, sent: result.sent, recipients: result.recipients }
    : { fired: false, reason: result.error };
}
