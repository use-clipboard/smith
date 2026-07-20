// Multi-step automation journeys.
//
// A journey automation enrolls each newly-matching recipient into
// campaign_journey_enrollments and then advances them through its steps
// independently: send email → wait N days → check a goal (met = journey done,
// else continue). All journey emails for one automation are sent under a single
// hidden "backing" campaign, so open/click tracking + client timeline all work
// through the normal machinery; that campaign is hidden from the Campaigns and
// Reports lists.

import type { SupabaseClient } from '@supabase/supabase-js';
import { getRefreshedGmailClient, buildRawMessage, gmailRetry, mapWithConcurrency } from '@/lib/gmail';
import { wrapBodyFont } from '@/lib/emailFonts';
import { getFirmEmailFont } from '@/lib/emailFirmSettings';
import { resolveCampaignMergeTags } from '@/lib/campaigns/mergeFields';
import { instrumentHtml } from '@/lib/campaigns/tracking';
import { getCampaignFirmSettings } from '@/lib/campaigns/settings';
import type { CampaignFirmSettings } from '@/types/campaigns';
import { resolveAudience } from '@/lib/campaigns/audience';
import { splitResolved } from '@/lib/campaigns/runSend';
import { TRIGGER_BY_TYPE } from '@/lib/campaigns/triggerMeta';
import { buildTriggerDefinition } from '@/lib/campaigns/automations';
import type { JourneyStep, JourneyGoal } from '@/types/campaigns';

const MAX_ENROLL_PER_RUN = 400;
const MAX_ADVANCE_PER_RUN = 400;
const ADVANCE_CONCURRENCY = 4;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Automation = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Enrollment = any;

// ── Enrollment ────────────────────────────────────────────────────────────────
/** Enroll newly-matching recipients of a journey automation. Skips anyone
 *  already active or enrolled within the trigger's cooldown. */
export async function enrollJourney(service: SupabaseClient, automation: Automation, now: Date): Promise<number> {
  const meta = TRIGGER_BY_TYPE[automation.trigger_type];
  if (!meta) return 0;
  const steps = (automation.steps ?? []) as JourneyStep[];
  if (steps.length === 0) return 0;

  // Resolve current matches.
  let resolved;
  try {
    if (meta.recurring) {
      if (!automation.audience_id) return 0;
      const { data: audience } = await service.from('campaign_audiences').select('*').eq('id', automation.audience_id).maybeSingle();
      if (!audience) return 0;
      resolved = await resolveAudience(service, automation.firm_id, { source: audience.source, definition: audience.definition, member_client_ids: audience.member_client_ids });
    } else {
      const days = Number(automation.trigger_config?.days ?? meta.defaultDays ?? 30);
      resolved = await resolveAudience(service, automation.firm_id, { source: 'dynamic', definition: buildTriggerDefinition(automation.trigger_type, days) ?? undefined });
    }
  } catch { return 0; }

  const { sendable } = splitResolved(resolved, 'per_email');
  if (sendable.length === 0) return 0;

  // Who's already in / recently in this journey?
  const cooldownIso = new Date(now.getTime() - (meta.cooldownDays || 30) * 86_400_000).toISOString();
  const { data: existing } = await service
    .from('campaign_journey_enrollments')
    .select('client_id, email, status, enrolled_at')
    .eq('automation_id', automation.id);
  const skipClients = new Set<string>();
  const skipEmails = new Set<string>();
  for (const e of (existing ?? [])) {
    const recent = e.status === 'active' || (e.enrolled_at && e.enrolled_at >= cooldownIso);
    if (!recent) continue;
    if (e.client_id) skipClients.add(e.client_id as string);
    if (e.email) skipEmails.add((e.email as string).toLowerCase());
  }

  let enrolled = 0;
  for (const r of sendable) {
    if (enrolled >= MAX_ENROLL_PER_RUN) break;
    const emailLc = r.email.toLowerCase();
    if ((r.client_id && skipClients.has(r.client_id)) || skipEmails.has(emailLc)) continue;
    try {
      const { error } = await service.from('campaign_journey_enrollments').insert({
        firm_id: automation.firm_id, automation_id: automation.id, client_id: r.client_id,
        email: r.email, name: r.name, merge_data: r.merge_data,
        step_index: 0, next_action_at: now.toISOString(), status: 'active',
      });
      if (!error) { enrolled++; skipEmails.add(emailLc); if (r.client_id) skipClients.add(r.client_id); }
    } catch { /* unique race — ignore */ }
  }
  return enrolled;
}

// ── Advance ───────────────────────────────────────────────────────────────────
/** Advance all due journey enrollments across all firms. */
export async function advanceEnrollments(service: SupabaseClient, now: Date): Promise<{ advanced: number }> {
  const { data: due } = await service
    .from('campaign_journey_enrollments')
    .select('*')
    .eq('status', 'active')
    .lte('next_action_at', now.toISOString())
    .order('next_action_at', { ascending: true })
    .limit(MAX_ADVANCE_PER_RUN);
  if (!due?.length) return { advanced: 0 };

  // Group by automation so we resolve the sender + settings once each.
  const byAutomation = new Map<string, Enrollment[]>();
  for (const e of due) {
    const arr = byAutomation.get(e.automation_id as string) ?? [];
    arr.push(e);
    byAutomation.set(e.automation_id as string, arr);
  }

  let advanced = 0;
  for (const [automationId, enrollments] of byAutomation) {
    const { data: automation } = await service.from('campaign_automations').select('*').eq('id', automationId).maybeSingle();
    if (!automation || automation.status !== 'active') continue;

    const { data: conn } = await service.from('email_connections').select('refresh_token, google_email').eq('user_id', automation.created_by).maybeSingle();
    if (!conn?.refresh_token) {
      // No sender — retry tomorrow rather than looping every run.
      const retry = new Date(now.getTime() + 86_400_000).toISOString();
      await service.from('campaign_journey_enrollments').update({ next_action_at: retry, updated_at: now.toISOString() }).in('id', enrollments.map(e => e.id));
      continue;
    }

    let gmail: Awaited<ReturnType<typeof getRefreshedGmailClient>>['gmail'];
    try { ({ gmail } = await getRefreshedGmailClient(conn.refresh_token as string)); }
    catch { continue; }

    const fs = await getCampaignFirmSettings(service, automation.firm_id);
    const font = automation.body_font || await getFirmEmailFont(service, automation.firm_id);
    const ctx: RunCtx = { service, automation, gmail, senderEmail: conn.google_email as string, font, fs, now, backingCampaignId: null };

    await mapWithConcurrency(enrollments, ADVANCE_CONCURRENCY, async (enr) => {
      try { await executeEnrollment(ctx, enr); advanced++; }
      catch (err) { console.error('[journeys] execute', enr.id, err); }
    });
  }
  return { advanced };
}

interface RunCtx {
  service: SupabaseClient;
  automation: Automation;
  gmail: Awaited<ReturnType<typeof getRefreshedGmailClient>>['gmail'];
  senderEmail: string;
  font: string;
  fs: CampaignFirmSettings;
  now: Date;
  backingCampaignId: string | null;
}

async function getBackingCampaign(ctx: RunCtx): Promise<string | null> {
  if (ctx.backingCampaignId) return ctx.backingCampaignId;
  const { service, automation } = ctx;
  const { data: existing } = await service.from('campaigns')
    .select('id').eq('firm_id', automation.firm_id).eq('settings->>journey_automation_id', automation.id).maybeSingle();
  if (existing) { ctx.backingCampaignId = existing.id as string; return ctx.backingCampaignId; }
  const { data: created } = await service.from('campaigns').insert({
    firm_id: automation.firm_id, name: `${automation.name} (journey)`, subject: '(journey)',
    status: 'sent', from_email: ctx.senderEmail, sent_at: ctx.now.toISOString(),
    settings: { journey_automation_id: automation.id }, created_by: automation.created_by,
  }).select('id').single();
  ctx.backingCampaignId = created?.id ?? null;
  return ctx.backingCampaignId;
}

/** Run one enrollment forward until it hits a wait, completes, or exits. */
async function executeEnrollment(ctx: RunCtx, enr: Enrollment) {
  const steps = (ctx.automation.steps ?? []) as JourneyStep[];
  let stepIndex: number = enr.step_index ?? 0;
  let status = 'active';
  let nextActionAt = ctx.now;
  let lastRecipientId: string | null = enr.last_recipient_id ?? null;
  let lastSentAt: string | null = enr.last_sent_at ?? null;

  // Bounded loop (a journey can't have more transitions than steps + slack).
  for (let guard = 0; guard <= steps.length + 1; guard++) {
    const step = steps[stepIndex];
    if (!step) { status = 'completed'; break; }

    if (step.type === 'email') {
      // Respect an unsubscribe that happened mid-journey.
      const { data: unsub } = await ctx.service.from('campaign_unsubscribes')
        .select('email').eq('firm_id', ctx.automation.firm_id).eq('email', enr.email.toLowerCase()).maybeSingle();
      if (unsub) { status = 'exited'; break; }

      const rid = await sendJourneyEmail(ctx, enr, step);
      if (rid) { lastRecipientId = rid; lastSentAt = ctx.now.toISOString(); }
      stepIndex++;
      continue;
    }

    if (step.type === 'wait') {
      nextActionAt = new Date(ctx.now.getTime() + Math.max(0, step.days) * 86_400_000);
      stepIndex++;
      break; // schedule and resume later
    }

    // check
    const met = await checkGoal(ctx.service, step.goal, { lastRecipientId, lastSentAt, clientId: enr.client_id ?? null });
    if (met) { status = 'completed'; break; }
    stepIndex++;
  }

  await ctx.service.from('campaign_journey_enrollments').update({
    step_index: stepIndex,
    status,
    next_action_at: nextActionAt.toISOString(),
    last_recipient_id: lastRecipientId,
    last_sent_at: lastSentAt,
    updated_at: ctx.now.toISOString(),
  }).eq('id', enr.id);
}

async function sendJourneyEmail(ctx: RunCtx, enr: Enrollment, step: Extract<JourneyStep, { type: 'email' }>): Promise<string | null> {
  const campaignId = await getBackingCampaign(ctx);
  if (!campaignId) return null;

  const { data: rc } = await ctx.service.from('campaign_recipients').insert({
    campaign_id: campaignId, firm_id: ctx.automation.firm_id, client_id: enr.client_id,
    email: enr.email, name: enr.name, merge_data: enr.merge_data, status: 'pending',
  }).select('id').single();
  if (!rc) return null;
  const rid = rc.id as string;

  const md = (enr.merge_data ?? {}) as Record<string, string>;
  try {
    const subject = resolveCampaignMergeTags(step.subject, md) || '(no subject)';
    const body = resolveCampaignMergeTags(step.body_html, md);
    const instrumented = instrumentHtml(body, rid, { unsubscribe: ctx.fs.include_unsubscribe, footerText: ctx.fs.unsubscribe_footer });
    const raw = buildRawMessage({
      from: ctx.senderEmail, to: [enr.email], subject,
      htmlBody: wrapBodyFont(instrumented, ctx.font), replyTo: ctx.fs.reply_to || undefined,
    });
    const res = await gmailRetry(() => ctx.gmail.users.messages.send({ userId: 'me', requestBody: { raw } }));
    await ctx.service.from('campaign_recipients').update({
      status: 'sent', message_id: res.data.id ?? null, thread_id: res.data.threadId ?? null, sent_at: ctx.now.toISOString(),
    }).eq('id', rid);
    await ctx.service.from('campaign_events').insert({ firm_id: ctx.automation.firm_id, campaign_id: campaignId, recipient_id: rid, type: 'send' });
    return rid;
  } catch (err) {
    const msg = err instanceof Error ? err.message.slice(0, 300) : 'Send failed';
    await ctx.service.from('campaign_recipients').update({ status: 'failed', error: msg }).eq('id', rid);
    return null;
  }
}

// ── Goal checks ───────────────────────────────────────────────────────────────
async function checkGoal(
  service: SupabaseClient,
  goal: JourneyGoal,
  ctx: { lastRecipientId: string | null; lastSentAt: string | null; clientId: string | null },
): Promise<boolean> {
  try {
    if (goal === 'opened' || goal === 'clicked') {
      if (!ctx.lastRecipientId) return false;
      const { data } = await service.from('campaign_recipients').select('opened_at, first_clicked_at').eq('id', ctx.lastRecipientId).maybeSingle();
      if (!data) return false;
      return goal === 'opened' ? !!data.opened_at : !!data.first_clicked_at;
    }
    // Activity-based goals: did the client do it since the last email?
    if (!ctx.clientId || !ctx.lastSentAt) return false;
    const since = ctx.lastSentAt;
    const anyRow = async (table: string, dateCol: string): Promise<boolean> => {
      const { data } = await service.from(table).select('client_id').eq('client_id', ctx.clientId).gte(dateCol, since).limit(1);
      return !!(data && data.length);
    };
    if (goal === 'uploaded_document') return (await anyRow('documents', 'created_at')) || (await anyRow('vault_documents', 'created_at'));
    if (goal === 'paid_invoice') return anyRow('invoices', 'paid_at');
    if (goal === 'completed_task') return anyRow('tasks', 'completed_at');
    return false;
  } catch { return false; }
}
