import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';
import { getRefreshedGmailClient, parseGmailMessage, type EmailThread } from '@/lib/gmail';

export async function GET(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  if (!ctx.activeModules.includes('email-triage')) {
    return NextResponse.json({ error: 'Module not active' }, { status: 403 });
  }

  const supabase = createClient();
  const { data: connection } = await supabase
    .from('email_connections')
    .select('refresh_token, inbox_label, show_as_threads, history_id')
    .eq('user_id', ctx.userId)
    .single();

  if (!connection?.refresh_token) {
    return NextResponse.json({ error: 'Gmail not connected' }, { status: 400 });
  }

  const { searchParams } = new URL(req.url);
  const label = searchParams.get('label') || connection.inbox_label || 'INBOX';
  const q = searchParams.get('q') || undefined;
  const pageToken = searchParams.get('pageToken') || undefined;
  const maxResults = 30;

  try {
    const { gmail, accessToken } = await getRefreshedGmailClient(connection.refresh_token);

    // Fetch thread list — use search query when provided, otherwise label filter
    const listRes = await gmail.users.threads.list({
      userId: 'me',
      ...(q ? { q } : { labelIds: [label] }),
      maxResults,
      pageToken,
    });

    const threadItems = listRes.data.threads ?? [];
    const nextPageToken = listRes.data.nextPageToken ?? null;

    // Fetch first message of each thread for preview
    const threads = await Promise.all(
      threadItems.map(async (t): Promise<EmailThread> => {
        try {
          const threadRes = await gmail.users.threads.get({
            userId: 'me',
            id: t.id!,
            format: 'metadata',
            metadataHeaders: ['Subject', 'From', 'To', 'Date'],
          });

          const messages = (threadRes.data.messages ?? []).map(m =>
            parseGmailMessage(m as Parameters<typeof parseGmailMessage>[0])
          );
          const first = messages[0];
          const last = messages[messages.length - 1];
          const hasUnread = messages.some(m => !m.isRead);
          const allLabelIds = Array.from(new Set(messages.flatMap(m => m.labelIds)));

          return {
            id: t.id ?? '',
            subject: first?.subject ?? '(no subject)',
            snippet: threadRes.data.snippet ?? '',
            from: last?.from ?? { name: '', email: '' },
            date: last?.date ?? first?.date ?? '',
            messageCount: messages.length,
            isRead: !hasUnread,
            labelIds: allLabelIds,
            messages,
          };
        } catch {
          return {
            id: t.id ?? '',
            subject: '(error loading)',
            snippet: '',
            from: { name: '', email: '' },
            date: '',
            messageCount: 1,
            isRead: true,
            labelIds: [],
            messages: [],
          };
        }
      })
    );

    // Save new history ID for incremental polling
    const historyId = listRes.data.resultSizeEstimate?.toString() ?? null;
    void historyId; // updated via the poll endpoint instead

    // Update access token in DB
    await supabase
      .from('email_connections')
      .update({ access_token: accessToken, updated_at: new Date().toISOString() })
      .eq('user_id', ctx.userId);

    return NextResponse.json({ threads, nextPageToken });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('Email threads fetch error:', message);
    // Surface the raw error so the client can display it for debugging
    return NextResponse.json({ error: message || 'Failed to fetch emails' }, { status: 500 });
  }
}
