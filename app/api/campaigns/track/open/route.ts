import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase-server';
import { verifyOpen, TRANSPARENT_GIF } from '@/lib/campaigns/tracking';

// GET /api/campaigns/track/open?r=<recipientId>&s=<sig>
// Records an open, then always returns a transparent 1×1 GIF (even on a bad
// signature — we never reveal validity to a fetcher).
export const dynamic = 'force-dynamic';

function pixel() {
  return new NextResponse(TRANSPARENT_GIF, {
    status: 200,
    headers: {
      'Content-Type': 'image/gif',
      'Content-Length': String(TRANSPARENT_GIF.length),
      'Cache-Control': 'no-store, no-cache, must-revalidate, private',
      Pragma: 'no-cache',
    },
  });
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const r = url.searchParams.get('r') ?? '';
  const s = url.searchParams.get('s') ?? '';
  if (!r || !s || !verifyOpen(r, s)) return pixel();

  try {
    const service = createServiceClient();
    const { data: rcpt } = await service
      .from('campaign_recipients')
      .select('id, firm_id, campaign_id, opened_at, open_count, status')
      .eq('id', r).maybeSingle();
    if (rcpt) {
      const patch: Record<string, unknown> = { open_count: ((rcpt.open_count as number) ?? 0) + 1 };
      if (!rcpt.opened_at) patch.opened_at = new Date().toISOString();
      // A recorded open confirms delivery.
      if (rcpt.status === 'sent') patch.status = 'delivered';
      await service.from('campaign_recipients').update(patch).eq('id', r);
      await service.from('campaign_events').insert({
        firm_id: rcpt.firm_id, campaign_id: rcpt.campaign_id, recipient_id: r, type: 'open',
        user_agent: (req.headers.get('user-agent') ?? '').slice(0, 300),
      });
    }
  } catch (err) {
    console.error('[campaigns/track/open]', err);
  }
  return pixel();
}
