import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase-server';
import { runAutomation, TRIGGER_BY_TYPE, computeNextRun } from '@/lib/campaigns/automations';
import { enrollJourney, advanceEnrollments } from '@/lib/campaigns/journeys';
import { getCampaignFirmSettings } from '@/lib/campaigns/settings';

// ─── /api/cron/campaigns-automations ───────────────────────────────────────
// Fires active campaign automations. Recurring ones fire when their next_run_at
// has arrived; event-based ones are evaluated every run (a per-client cooldown
// in campaign_automation_runs stops daily re-sends). Each fires as its author's
// connected Gmail.

export const maxDuration = 300;

function isAuthorisedCron(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.warn('[campaigns-automations] CRON_SECRET not set — allowing request.');
    return true;
  }
  return request.headers.get('authorization') === `Bearer ${secret}`;
}

export async function GET(request: Request) {
  if (!isAuthorisedCron(request)) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const service = createServiceClient();
  const now = new Date();

  const { data: automations } = await service
    .from('campaign_automations')
    .select('*')
    .eq('status', 'active')
    .limit(200);

  const results: { id: string; fired: boolean; sent?: number; reason?: string }[] = [];

  // Firm-level approval settings, cached per firm across this run.
  const settingsByFirm = new Map<string, Awaited<ReturnType<typeof getCampaignFirmSettings>>>();
  async function firmSettings(firmId: string) {
    if (!settingsByFirm.has(firmId)) settingsByFirm.set(firmId, await getCampaignFirmSettings(service, firmId));
    return settingsByFirm.get(firmId)!;
  }

  for (const a of (automations ?? [])) {
    try {
      const meta = TRIGGER_BY_TYPE[a.trigger_type];
      if (!meta) continue;

      // Defensive: never fire an unapproved automation when the firm requires
      // review, even if one slipped past the activation guard.
      const fs = await firmSettings(a.firm_id);
      if (fs.require_approval && !a.approved_at) {
        results.push({ id: a.id, fired: false, reason: 'Awaiting approval' });
        continue;
      }

      // Recurring only fires once its scheduled time has arrived.
      if (meta.recurring) {
        if (!a.next_run_at || new Date(a.next_run_at) > now) { continue; }
      }

      // ── Journey automations: enroll new matches; the advance pass (below)
      // progresses everyone through the steps. ──
      if (a.mode === 'journey') {
        const enrolled = await enrollJourney(service, a, now);
        if (meta.recurring) {
          await service.from('campaign_automations')
            .update({ last_run_at: now.toISOString(), next_run_at: computeNextRun(a.trigger_config ?? {}, now).toISOString(), updated_at: now.toISOString() })
            .eq('id', a.id);
        } else {
          await service.from('campaign_automations').update({ last_run_at: now.toISOString(), updated_at: now.toISOString() }).eq('id', a.id);
        }
        results.push({ id: a.id, fired: enrolled > 0, sent: enrolled, reason: `enrolled ${enrolled}` });
        continue;
      }

      if (!a.created_by) { results.push({ id: a.id, fired: false, reason: 'No author to send as' }); continue; }
      const { data: conn } = await service
        .from('email_connections').select('refresh_token, google_email').eq('user_id', a.created_by).maybeSingle();
      if (!conn?.refresh_token) { results.push({ id: a.id, fired: false, reason: 'Author has no connected Gmail' }); continue; }

      const res = await runAutomation({ service, automation: a, senderEmail: conn.google_email, senderRefreshToken: conn.refresh_token, now });
      results.push({ id: a.id, fired: res.fired, sent: res.sent, reason: res.reason });
    } catch (err) {
      console.error('[campaigns-automations]', a.id, err);
      results.push({ id: a.id, fired: false, reason: 'Unexpected error' });
    }
  }

  // Advance all due journey enrollments (across every firm) in one pass.
  let advanced = 0;
  try { advanced = (await advanceEnrollments(service, now)).advanced; }
  catch (err) { console.error('[campaigns-automations] advance', err); }

  return NextResponse.json({ processed: results.length, advanced, results });
}
