import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { getCampaignsContext } from '@/lib/campaigns/guard';

// GET /api/campaigns/[id]/report — engagement report for a sent campaign.
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getCampaignsContext();
  if (!ctx) return NextResponse.json({ error: 'No access' }, { status: 403 });

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

  return NextResponse.json({ campaign, totals, topLinks, timeline, recipients: rcpts });
}
