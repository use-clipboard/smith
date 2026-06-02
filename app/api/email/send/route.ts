import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';
import { getRefreshedGmailClient, buildRawMessage, firstInvalidRecipient } from '@/lib/gmail';

export async function POST(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  if (!ctx.activeModules.includes('email-triage')) {
    return NextResponse.json({ error: 'Module not active' }, { status: 403 });
  }

  const supabase = createClient();
  const { data: connection } = await supabase
    .from('email_connections')
    .select('refresh_token, google_email')
    .eq('user_id', ctx.userId)
    .single();

  if (!connection?.refresh_token) {
    return NextResponse.json({ error: 'Gmail not connected' }, { status: 400 });
  }

  // Parse as FormData to support file attachments
  let to: string[] = [];
  let cc: string[] = [];
  let bcc: string[] = [];
  let subject = '';
  let htmlBody = '';
  let replyToMessageId: string | undefined;
  let threadId: string | undefined;
  let attachments: Array<{ filename: string; mimeType: string; data: Buffer }> = [];

  const contentType = req.headers.get('content-type') ?? '';

  if (contentType.includes('multipart/form-data')) {
    const formData = await req.formData();
    to = JSON.parse((formData.get('to') as string) || '[]') as string[];
    cc = JSON.parse((formData.get('cc') as string) || '[]') as string[];
    bcc = JSON.parse((formData.get('bcc') as string) || '[]') as string[];
    subject = (formData.get('subject') as string) || '';
    htmlBody = (formData.get('htmlBody') as string) || '';
    replyToMessageId = (formData.get('replyToMessageId') as string) || undefined;
    threadId = (formData.get('threadId') as string) || undefined;
    const files = formData.getAll('attachments') as File[];
    attachments = await Promise.all(
      files.map(async f => ({
        filename: f.name,
        mimeType: f.type || 'application/octet-stream',
        data: Buffer.from(await f.arrayBuffer()),
      }))
    );
  } else {
    const body = await req.json() as Record<string, unknown>;
    to = (body.to as string[]) ?? [];
    cc = (body.cc as string[]) ?? [];
    bcc = (body.bcc as string[]) ?? [];
    subject = (body.subject as string) ?? '';
    htmlBody = (body.htmlBody as string) ?? '';
    replyToMessageId = body.replyToMessageId as string | undefined;
    threadId = body.threadId as string | undefined;
  }

  if (!to.length) {
    return NextResponse.json({ error: 'At least one recipient required' }, { status: 400 });
  }

  // Reject malformed recipients (e.g. raw header text pasted into a field)
  // before they reach the message builder — a friendly error beats a cryptic
  // Gmail rejection or a silently broken send.
  const badRecipient = firstInvalidRecipient([...to, ...cc, ...bcc]);
  if (badRecipient) {
    return NextResponse.json(
      { error: `Invalid recipient address: "${badRecipient.slice(0, 80)}". Please check the To, Cc and Bcc fields.` },
      { status: 400 },
    );
  }

  try {
    const { gmail, accessToken } = await getRefreshedGmailClient(connection.refresh_token);

    const raw = buildRawMessage({
      from: connection.google_email,
      to, cc, bcc,
      subject: subject || '(no subject)',
      htmlBody,
      replyToMessageId,
      attachments: attachments.length > 0 ? attachments : undefined,
    });

    const sendRes = await gmail.users.messages.send({
      userId: 'me',
      requestBody: { raw, threadId },
    });

    await supabase
      .from('email_connections')
      .update({ access_token: accessToken, updated_at: new Date().toISOString() })
      .eq('user_id', ctx.userId);

    return NextResponse.json({
      messageId: sendRes.data.id,
      threadId: sendRes.data.threadId,
    });
  } catch (err) {
    // Extract the most useful part of the Gmail API error
    let message = 'Failed to send email';
    if (err instanceof Error) {
      // Gmail API errors often have a `message` like "Invalid Credentials" or include a code
      message = err.message.slice(0, 300);
    }
    console.error('Email send error:', err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
