import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase-server';
import { getCampaignsContext } from '@/lib/campaigns/guard';
import { runCampaignSend } from '@/lib/campaigns/runSend';

export const maxDuration = 300;

// POST /api/campaigns/[id]/send — send the campaign now over the caller's Gmail.
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getCampaignsContext();
  if (!ctx) return NextResponse.json({ error: 'No access' }, { status: 403 });

  if (!ctx.activeModules.includes('email-triage')) {
    return NextResponse.json({ error: 'Connect your Gmail (Email Triage) to send campaigns.' }, { status: 400 });
  }

  const supabase = createClient();
  const service = createServiceClient();

  const { data: connection } = await supabase
    .from('email_connections').select('refresh_token, google_email').eq('user_id', ctx.userId).maybeSingle();
  if (!connection?.refresh_token) {
    return NextResponse.json({ error: 'Gmail is not connected. Connect it in Email Triage first.' }, { status: 400 });
  }

  const { data: campaign } = await supabase
    .from('campaigns').select('*').eq('id', params.id).eq('firm_id', ctx.firmId).maybeSingle();
  if (!campaign) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const result = await runCampaignSend({
    service, read: supabase, firmId: ctx.firmId, campaign,
    senderEmail: connection.google_email, senderRefreshToken: connection.refresh_token,
  });

  if (result.ok) {
    // Audit trail: who actually pressed send.
    await supabase.from('campaign_approvals').insert({
      firm_id: ctx.firmId, campaign_id: params.id, user_id: ctx.userId, action: 'sent',
      comment: `Sent to ${result.sent} recipient${result.sent === 1 ? '' : 's'}`,
    }).then(undefined, () => { /* non-fatal */ });
    return NextResponse.json({ ok: true, sent: result.sent, failed: result.failed, recipients: result.recipients });
  }
  return NextResponse.json({ error: result.error }, { status: result.status });
}
