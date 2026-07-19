import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase-server';
import { runAutomation, TRIGGER_BY_TYPE } from '@/lib/campaigns/automations';

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

  for (const a of (automations ?? [])) {
    try {
      const meta = TRIGGER_BY_TYPE[a.trigger_type];
      if (!meta) continue;

      // Recurring only fires once its scheduled time has arrived.
      if (meta.recurring) {
        if (!a.next_run_at || new Date(a.next_run_at) > now) { continue; }
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

  return NextResponse.json({ processed: results.length, results });
}
