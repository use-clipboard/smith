import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';
import { getRefreshedGmailClient, buildRawMessage } from '@/lib/gmail';

const DraftSchema = z.object({
  to: z.array(z.string()).min(1),
  cc: z.array(z.string()).default([]),
  subject: z.string(),
  htmlBody: z.string(),
  replyToMessageId: z.string().optional(),
  threadId: z.string().optional(),
  fromEmail: z.string().optional(),
  fromName: z.string().optional(),
});

export async function POST(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const body = await req.json();
  const parsed = DraftSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'Invalid' }, { status: 400 });

  const supabase = createClient();
  const { data: connection } = await supabase
    .from('email_connections')
    .select('refresh_token, google_email')
    .eq('user_id', ctx.userId)
    .single();

  if (!connection?.refresh_token) {
    return NextResponse.json({ error: 'Gmail not connected' }, { status: 400 });
  }

  try {
    const { gmail } = await getRefreshedGmailClient(connection.refresh_token);
    const fromEmail = parsed.data.fromEmail || connection.google_email || '';
    const fromName = parsed.data.fromName;
    const from = fromName ? `${fromName} <${fromEmail}>` : fromEmail;

    const raw = buildRawMessage({
      from,
      to: parsed.data.to,
      cc: parsed.data.cc.length > 0 ? parsed.data.cc : undefined,
      subject: parsed.data.subject,
      htmlBody: parsed.data.htmlBody,
      replyToMessageId: parsed.data.replyToMessageId,
    });

    const res = await gmail.users.drafts.create({
      userId: 'me',
      requestBody: {
        message: {
          raw,
          ...(parsed.data.threadId ? { threadId: parsed.data.threadId } : {}),
        },
      },
    });

    return NextResponse.json({ draftId: res.data.id });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('Draft save error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
