import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { getCampaignsContext } from '@/lib/campaigns/guard';
import { getCampaignFirmSettings } from '@/lib/campaigns/settings';
import {
  checkDomainAuth, checkSendHealth, domainFromEmail, isConsumerGmail,
  type DeliverabilityCheck,
} from '@/lib/campaigns/deliverability';

// GET /api/campaigns/deliverability — live SPF/DKIM/DMARC lookups for the
// sending domain, plus health derived from this firm's own send history.
export const maxDuration = 30;
export const dynamic = 'force-dynamic';

export async function GET() {
  const ctx = await getCampaignsContext();
  if (!ctx) return NextResponse.json({ error: 'No access' }, { status: 403 });

  const supabase = createClient();

  const [{ data: connection }, settings] = await Promise.all([
    supabase.from('email_connections').select('google_email').eq('user_id', ctx.userId).maybeSingle(),
    getCampaignFirmSettings(supabase, ctx.firmId),
  ]);

  const senderEmail = connection?.google_email ?? null;
  const domain = domainFromEmail(senderEmail);
  const consumer = isConsumerGmail(domain);

  // ── Send history (last 90 days) ─────────────────────────────────────────────
  const since = new Date(Date.now() - 90 * 86_400_000).toISOString();
  const { data: recipients } = await supabase
    .from('campaign_recipients')
    .select('sent_at, bounced_at, unsubscribed_at')
    .eq('firm_id', ctx.firmId)
    .gte('sent_at', since);

  const rows = recipients ?? [];
  const dayAgo = Date.now() - 86_400_000;
  const stats = {
    sent: rows.length,
    bounced: rows.filter(r => r.bounced_at).length,
    unsubscribed: rows.filter(r => r.unsubscribed_at).length,
    sentLast24h: rows.filter(r => r.sent_at && new Date(r.sent_at as string).getTime() >= dayAgo).length,
    includeUnsubscribe: settings.include_unsubscribe,
  };

  // ── Domain authentication ───────────────────────────────────────────────────
  let authChecks: DeliverabilityCheck[] = [];
  if (!domain) {
    authChecks = [{
      id: 'domain', label: 'Sending domain', status: 'unknown',
      detail: 'No Gmail account connected, so there’s no domain to check.',
      fix: 'Connect the Gmail account you send campaigns from.',
    }];
  } else if (consumer) {
    authChecks = [{
      id: 'domain', label: 'Sending domain', status: 'warn',
      detail: `You’re sending from a personal ${domain} address.`,
      value: senderEmail ?? undefined,
      fix: 'SPF, DKIM and DMARC are controlled by Google for consumer Gmail, so you can’t tune them. For client-facing campaigns, send from a Google Workspace address on your firm’s own domain.',
    }];
  } else {
    try {
      authChecks = await checkDomainAuth(domain);
    } catch {
      authChecks = [{
        id: 'domain', label: 'Sending domain', status: 'unknown',
        detail: 'Couldn’t complete the DNS lookups just now — try again shortly.',
      }];
    }
  }

  const checks = [...authChecks, ...checkSendHealth(stats)];
  const summary = {
    pass: checks.filter(c => c.status === 'pass').length,
    warn: checks.filter(c => c.status === 'warn').length,
    fail: checks.filter(c => c.status === 'fail').length,
  };

  return NextResponse.json({ domain, senderEmail, consumer, checks, summary });
}
