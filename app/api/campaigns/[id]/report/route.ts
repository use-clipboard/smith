import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { getCampaignsContext } from '@/lib/campaigns/guard';
import { computeCampaignOutcomes } from '@/lib/campaigns/outcomes';

const ALLOWED_WINDOWS = [7, 14, 30];

// GET /api/campaigns/[id]/report?window=14 — engagement + outcomes for a sent campaign.
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getCampaignsContext();
  if (!ctx) return NextResponse.json({ error: 'No access' }, { status: 403 });

  const windowParam = Number(new URL(req.url).searchParams.get('window'));
  const windowDays = ALLOWED_WINDOWS.includes(windowParam) ? windowParam : 14;

  const supabase = createClient();
  const { data: campaign } = await supabase
    .from('campaigns').select('id, name, subject, status, sent_at, stats')
    .eq('id', params.id).eq('firm_id', ctx.firmId).maybeSingle();
  if (!campaign) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const { data: recipients } = await supabase
    .from('campaign_recipients')
    .select('id, client_id, email, name, status, opened_at, first_clicked_at, open_count, click_count, unsubscribed_at, bounced_at, replied_at')
    .eq('campaign_id', params.id);

  const { data: events } = await supabase
    .from('campaign_events')
    .select('type, url, created_at')
    .eq('campaign_id', params.id)
    .order('created_at', { ascending: true });

  const rcpts = recipients ?? [];
  const totals = {
    recipients: rcpts.length,
    sent: rcpts.filter(r => ['sent', 'delivered', 'bounced'].includes(r.status as string) || r.opened_at || r.first_clicked_at).length,
    opened: rcpts.filter(r => r.opened_at).length,
    clicked: rcpts.filter(r => r.first_clicked_at).length,
    replied: rcpts.filter(r => r.replied_at).length,
    bounced: rcpts.filter(r => r.bounced_at).length,
    unsubscribed: rcpts.filter(r => r.unsubscribed_at).length,
    failed: rcpts.filter(r => r.status === 'failed').length,
    skipped: rcpts.filter(r => ['skipped', 'suppressed'].includes(r.status as string)).length,
  };

  // Link click tally.
  const linkCounts = new Map<string, number>();
  for (const e of (events ?? [])) {
    if (e.type === 'click' && e.url) linkCounts.set(e.url as string, (linkCounts.get(e.url as string) ?? 0) + 1);
  }
  const topLinks = Array.from(linkCounts.entries())
    .map(([url, count]) => ({ url, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  // Opens/clicks per day for a small timeline chart.
  const byDay = new Map<string, { date: string; opens: number; clicks: number }>();
  for (const e of (events ?? [])) {
    if (e.type !== 'open' && e.type !== 'click') continue;
    const day = (e.created_at as string).slice(0, 10);
    const cur = byDay.get(day) ?? { date: day, opens: 0, clicks: 0 };
    if (e.type === 'open') cur.opens++; else cur.clicks++;
    byDay.set(day, cur);
  }
  const timeline = Array.from(byDay.values()).sort((a, b) => a.date.localeCompare(b.date));

  // ── Outcome-linking: what recipient clients did AFTER the send ───────────────
  const clientIds = rcpts.map(r => r.client_id as string | null).filter((v): v is string => !!v);
  const outcomes = await computeCampaignOutcomes(supabase, clientIds, campaign.sent_at as string, windowDays);

  // Annotate each recipient with its outcome flags for the recipient list.
  const recipientsWithOutcomes = rcpts.map(r => ({
    ...r,
    outcomes: r.client_id ? (outcomes.byClient[r.client_id as string] ?? null) : null,
  }));

  return NextResponse.json({ campaign, totals, topLinks, timeline, outcomes, recipients: recipientsWithOutcomes });
}
