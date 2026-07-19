import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase-server';
import { verifyClick } from '@/lib/campaigns/tracking';

// GET /api/campaigns/track/click?r=<recipientId>&u=<targetUrl>&s=<sig>
// Records a click, then 302s to the target. The signature covers the URL, so a
// tampered target won't verify — this can't be used as an open redirect.
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const r = url.searchParams.get('r') ?? '';
  const target = url.searchParams.get('u') ?? '';
  const s = url.searchParams.get('s') ?? '';

  // Only redirect to a signature-verified absolute http(s) URL.
  if (!r || !target || !s || !verifyClick(r, target, s) || !/^https?:\/\//i.test(target)) {
    return NextResponse.json({ error: 'Invalid link' }, { status: 400 });
  }

  try {
    const service = createServiceClient();
    const { data: rcpt } = await service
      .from('campaign_recipients')
      .select('id, firm_id, campaign_id, opened_at, first_clicked_at, click_count, status')
      .eq('id', r).maybeSingle();
    if (rcpt) {
      const now = new Date().toISOString();
      const patch: Record<string, unknown> = { click_count: ((rcpt.click_count as number) ?? 0) + 1 };
      if (!rcpt.first_clicked_at) patch.first_clicked_at = now;
      if (!rcpt.opened_at) patch.opened_at = now; // a click implies an open
      if (rcpt.status === 'sent') patch.status = 'delivered';
      await service.from('campaign_recipients').update(patch).eq('id', r);
      await service.from('campaign_events').insert({
        firm_id: rcpt.firm_id, campaign_id: rcpt.campaign_id, recipient_id: r, type: 'click', url: target,
        user_agent: (req.headers.get('user-agent') ?? '').slice(0, 300),
      });
    }
  } catch (err) {
    console.error('[campaigns/track/click]', err);
  }

  return NextResponse.redirect(target, 302);
}
