import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase-server';
import { getCampaignsContext } from '@/lib/campaigns/guard';
import { getRefreshedGmailClient, buildRawMessage, gmailRetry } from '@/lib/gmail';
import { wrapBodyFont } from '@/lib/emailFonts';
import { getFirmEmailFont } from '@/lib/emailFirmSettings';
import { resolveAudience } from '@/lib/campaigns/audience';
import { resolveCampaignMergeTags } from '@/lib/campaigns/mergeFields';
import { getCampaignFirmSettings } from '@/lib/campaigns/settings';

export const maxDuration = 60;

const Schema = z.object({
  to: z.string().email().optional(),
  clientId: z.string().uuid().optional(),  // preview-as a specific client
});

// POST /api/campaigns/[id]/test — send a single test copy (no tracking, no
// recorded recipients, no effect on stats).
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getCampaignsContext();
  if (!ctx) return NextResponse.json({ error: 'No access' }, { status: 403 });
  if (!ctx.activeModules.includes('email-triage')) {
    return NextResponse.json({ error: 'Connect your Gmail (Email) to send a test.' }, { status: 400 });
  }

  const parsed = Schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const supabase = createClient();
  const { data: connection } = await supabase
    .from('email_connections').select('refresh_token, google_email').eq('user_id', ctx.userId).maybeSingle();
  if (!connection?.refresh_token) {
    return NextResponse.json({ error: 'Gmail is not connected.' }, { status: 400 });
  }

  const { data: campaign } = await supabase
    .from('campaigns').select('*').eq('id', params.id).eq('firm_id', ctx.firmId).maybeSingle();
  if (!campaign) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // Merge data: from the chosen client, else neutral fallbacks.
  let mergeData: Record<string, string> = {};
  if (parsed.data.clientId) {
    try {
      const recips = await resolveAudience(supabase, ctx.firmId, {
        source: 'manual', member_client_ids: [parsed.data.clientId],
      });
      if (recips[0]) mergeData = recips[0].merge_data;
    } catch { /* fall back to empty merge data */ }
  }

  const to = parsed.data.to || connection.google_email;
  const font = campaign.body_font || await getFirmEmailFont(supabase, ctx.firmId);
  const subject = `[TEST] ${resolveCampaignMergeTags(campaign.subject, mergeData) || '(no subject)'}`;
  const body = resolveCampaignMergeTags(campaign.body_html, mergeData);

  const fs = await getCampaignFirmSettings(supabase, ctx.firmId);
  const replyTo = campaign.reply_to || fs.reply_to || undefined;

  try {
    const { gmail } = await getRefreshedGmailClient(connection.refresh_token);
    const raw = buildRawMessage({
      from: connection.google_email,
      to: [to],
      subject,
      htmlBody: wrapBodyFont(body, font),
      replyTo,
    });
    await gmailRetry(() => gmail.users.messages.send({ userId: 'me', requestBody: { raw } }));
    return NextResponse.json({ ok: true, to });
  } catch (err) {
    const msg = err instanceof Error ? err.message.slice(0, 300) : 'Send failed';
    console.error('[campaigns/test]', err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
