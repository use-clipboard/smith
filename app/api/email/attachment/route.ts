import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';
import { getRefreshedGmailClient } from '@/lib/gmail';

const Schema = z.object({
  messageId: z.string().min(1),
  attachmentId: z.string().min(1),
  filename: z.string().default('attachment'),
  mimeType: z.string().default('application/octet-stream'),
});

export async function GET(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const parsed = Schema.safeParse({
    messageId: searchParams.get('messageId'),
    attachmentId: searchParams.get('attachmentId'),
    filename: searchParams.get('filename') ?? 'attachment',
    mimeType: searchParams.get('mimeType') ?? 'application/octet-stream',
  });
  if (!parsed.success) return NextResponse.json({ error: 'Invalid params' }, { status: 400 });

  const supabase = createClient();
  const { data: connection } = await supabase
    .from('email_connections')
    .select('refresh_token')
    .eq('user_id', ctx.userId)
    .single();

  if (!connection?.refresh_token) {
    return NextResponse.json({ error: 'Gmail not connected' }, { status: 400 });
  }

  try {
    const { gmail } = await getRefreshedGmailClient(connection.refresh_token);
    const att = await gmail.users.messages.attachments.get({
      userId: 'me',
      messageId: parsed.data.messageId,
      id: parsed.data.attachmentId,
    });

    const data = att.data.data;
    if (!data) return NextResponse.json({ error: 'No attachment data' }, { status: 404 });

    const buffer = Buffer.from(data, 'base64url');
    const { mimeType, filename } = parsed.data;

    // Open PDFs and images inline; download everything else
    const isInline = mimeType.startsWith('image/') || mimeType === 'application/pdf';
    const disposition = isInline
      ? `inline; filename="${filename}"`
      : `attachment; filename="${filename}"`;

    return new NextResponse(buffer, {
      headers: {
        'Content-Type': mimeType,
        'Content-Disposition': disposition,
        'Content-Length': String(buffer.length),
        'Cache-Control': 'private, max-age=300',
      },
    });
  } catch (err) {
    console.error('Attachment fetch error:', err);
    return NextResponse.json({ error: 'Failed to fetch attachment' }, { status: 500 });
  }
}
