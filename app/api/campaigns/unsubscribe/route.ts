import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase-server';
import { verifyUnsubscribe } from '@/lib/campaigns/tracking';

// GET /api/campaigns/unsubscribe?r=<recipientId>&s=<sig>
// One-click unsubscribe from a campaign footer. Adds the address to the firm's
// suppression list and returns a plain confirmation page.
export const dynamic = 'force-dynamic';

function page(title: string, message: string, ok: boolean) {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head>
<body style="margin:0;font-family:Arial,Helvetica,sans-serif;background:#f5f5f7;color:#1d1d1f;">
  <div style="max-width:480px;margin:12vh auto;padding:32px;background:#fff;border-radius:16px;box-shadow:0 1px 3px rgba(0,0,0,.08);text-align:center;">
    <div style="font-size:34px;margin-bottom:8px;">${ok ? '✓' : '⚠️'}</div>
    <h1 style="font-size:20px;margin:0 0 8px;">${title}</h1>
    <p style="font-size:14px;color:#6e6e73;line-height:1.5;margin:0;">${message}</p>
  </div>
</body></html>`;
  return new NextResponse(html, { status: ok ? 200 : 400, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const r = url.searchParams.get('r') ?? '';
  const s = url.searchParams.get('s') ?? '';
  if (!r || !s || !verifyUnsubscribe(r, s)) {
    return page('Invalid link', 'This unsubscribe link is not valid. Please contact the firm directly.', false);
  }

  try {
    const service = createServiceClient();
    const { data: rcpt } = await service
      .from('campaign_recipients')
      .select('id, firm_id, campaign_id, client_id, email')
      .eq('id', r).maybeSingle();
    if (!rcpt) return page('Invalid link', 'We could not find this subscription.', false);

    const email = ((rcpt.email as string) ?? '').trim().toLowerCase();
    await service.from('campaign_unsubscribes').upsert({
      firm_id: rcpt.firm_id, email, client_id: rcpt.client_id, campaign_id: rcpt.campaign_id, scope: 'marketing',
    }, { onConflict: 'firm_id,email' });
    await service.from('campaign_recipients')
      .update({ unsubscribed_at: new Date().toISOString(), status: 'unsubscribed' }).eq('id', r);
    await service.from('campaign_events').insert({
      firm_id: rcpt.firm_id, campaign_id: rcpt.campaign_id, recipient_id: r, type: 'unsubscribe',
    });

    return page('You’ve been unsubscribed', 'You will no longer receive marketing communications from this firm. Statutory and service communications about your account may still be sent.', true);
  } catch (err) {
    console.error('[campaigns/unsubscribe]', err);
    return page('Something went wrong', 'We could not process your request. Please contact the firm directly.', false);
  }
}
