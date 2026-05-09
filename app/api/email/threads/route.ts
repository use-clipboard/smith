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
  const taskLinkedOnly = searchParams.get('taskLinkedOnly') === 'true';
  const allocatedOnly = searchParams.get('allocatedOnly') === 'true';
  const maxResults = 50;

  // ── DB-driven filters: task-linked / client-allocated ──────────────────────
  // These filters search the user's entire mailbox by joining against our DB
  // tables, then fetching only the matching threads from Gmail. They behave
  // like the unread filter (inbox-wide), but the data lives outside Gmail.
  let restrictThreadIds: string[] | null = null;
  if (taskLinkedOnly || allocatedOnly) {
    const sets: string[][] = [];
    if (taskLinkedOnly) {
      const { data: links } = await supabase
        .from('email_task_links')
        .select('thread_id')
        .eq('firm_id', ctx.firmId);
      sets.push((links ?? []).map(r => r.thread_id as string));
    }
    if (allocatedOnly) {
      const { data: allocs } = await supabase
        .from('email_allocations')
        .select('thread_id')
        .eq('firm_id', ctx.firmId);
      sets.push((allocs ?? []).map(r => r.thread_id as string));
    }
    // Intersect when both filters are on, else use the single set
    restrictThreadIds = sets.length === 1
      ? Array.from(new Set(sets[0]))
      : Array.from(new Set(sets[0].filter(id => sets[1].includes(id))));
  }

  try {
    const { gmail, accessToken } = await getRefreshedGmailClient(connection.refresh_token);

    const showAsThreads = connection.show_as_threads !== false; // default true

    let threads: EmailThread[];
    let nextPageToken: string | null;

    // When DB filters are active, bypass Gmail's list/search and fetch each
    // matching thread directly. Pagination is dropped — these sets are bounded
    // by what the firm has linked, typically far smaller than an inbox page.
    if (restrictThreadIds !== null) {
      nextPageToken = null;
      const ids = restrictThreadIds.slice(0, 200); // safety cap
      threads = await Promise.all(
        ids.map(async (id): Promise<EmailThread> => {
          try {
            const threadRes = await gmail.users.threads.get({
              userId: 'me',
              id,
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
              id,
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
              id,
              subject: '(unavailable)',
              snippet: '',
              from: { name: '', email: '' },
              date: '',
              messageCount: 0,
              isRead: true,
              labelIds: [],
              messages: [],
            };
          }
        })
      );
      // Most recent first
      threads.sort((a, b) => (new Date(b.date).getTime() || 0) - (new Date(a.date).getTime() || 0));

      await supabase
        .from('email_connections')
        .update({ access_token: accessToken, updated_at: new Date().toISOString() })
        .eq('user_id', ctx.userId);

      return NextResponse.json({ threads, nextPageToken });
    }

    if (showAsThreads) {
      // ── Threaded mode: group messages into conversations ──────────────────
      const listRes = await gmail.users.threads.list({
        userId: 'me',
        ...(q ? { q } : { labelIds: [label] }),
        maxResults,
        pageToken,
      });

      const threadItems = listRes.data.threads ?? [];
      nextPageToken = listRes.data.nextPageToken ?? null;

      threads = await Promise.all(
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
    } else {
      // ── Non-threaded mode: each message is its own list item ──────────────
      const listRes = await gmail.users.messages.list({
        userId: 'me',
        ...(q ? { q } : { labelIds: [label] }),
        maxResults,
        pageToken,
      });

      const msgItems = listRes.data.messages ?? [];
      nextPageToken = listRes.data.nextPageToken ?? null;

      threads = await Promise.all(
        msgItems.map(async (m): Promise<EmailThread> => {
          try {
            const msgRes = await gmail.users.messages.get({
              userId: 'me',
              id: m.id!,
              format: 'metadata',
              metadataHeaders: ['Subject', 'From', 'To', 'Date'],
            });

            const parsed = parseGmailMessage(msgRes.data as Parameters<typeof parseGmailMessage>[0]);

            return {
              // Use message ID as the list key; store real threadId so detail view works
              id: m.id ?? '',
              gmailThreadId: msgRes.data.threadId ?? m.id ?? '',
              subject: parsed.subject ?? '(no subject)',
              snippet: msgRes.data.snippet ?? '',
              from: parsed.from,
              date: parsed.date,
              messageCount: 1,
              isRead: parsed.isRead,
              labelIds: parsed.labelIds,
              messages: [parsed],
            };
          } catch {
            return {
              id: m.id ?? '',
              gmailThreadId: m.id ?? '',
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
    }

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
