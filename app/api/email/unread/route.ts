import { NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';
import { getRefreshedGmailClient } from '@/lib/gmail';

export async function GET() {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ count: 0 });

  if (!ctx.activeModules.includes('email-triage')) {
    return NextResponse.json({ count: 0 });
  }

  const supabase = createClient();
  const { data: connection } = await supabase
    .from('email_connections')
    .select('refresh_token')
    .eq('user_id', ctx.userId)
    .single();

  if (!connection?.refresh_token) return NextResponse.json({ count: 0 });

  try {
    const { gmail } = await getRefreshedGmailClient(connection.refresh_token);
    const label = await gmail.users.labels.get({ userId: 'me', id: 'INBOX' });
    // Use messagesUnread (not threadsUnread) so the count matches the Inbox
    // tab, which counts unread messages. The inbox is flat/ungrouped by
    // default, so each unread message is its own row; threadsUnread
    // under-counts when a sender piles many unread messages into one thread.
    const count = label.data.messagesUnread ?? label.data.threadsUnread ?? 0;

    // Untriaged = EXACT count of inbox EMAILS the caller hasn't categorised.
    // Triage is per user, per email: we enumerate the inbox's message ids and
    // check them against this user's triage rows. No row = untriaged for them.
    // This number drives the Untriaged card and the sidebar badge, and makes
    // "every new email arrives untriaged" hold by construction — a new email
    // has no row until its owner triages it.
    let untriaged = 0;
    try {
      const inboxIds: string[] = [];
      let pageToken: string | undefined;
      for (let page = 0; page < 25; page++) { // 25 × 500 = up to 12,500 emails
        const res = await gmail.users.messages.list({
          userId: 'me', labelIds: ['INBOX'], maxResults: 500, pageToken,
        });
        for (const m of res.data.messages ?? []) if (m.id) inboxIds.push(m.id);
        pageToken = res.data.nextPageToken ?? undefined;
        if (!pageToken) break;
      }

      const svc = createServiceClient();
      const categorised = new Set<string>();
      const PAGE = 1000;
      for (let from = 0; ; from += PAGE) {
        const { data } = await svc
          .from('email_message_triage')
          .select('message_id')
          .eq('user_id', ctx.userId)
          .neq('category', 'untriaged')
          .range(from, from + PAGE - 1);
        for (const r of data ?? []) categorised.add(r.message_id as string);
        if (!data || data.length < PAGE) break;
      }
      untriaged = inboxIds.filter(id => !categorised.has(id)).length;
    } catch { /* table missing pre-migration — badge just hides */ }

    return NextResponse.json({ count, untriaged });
  } catch {
    return NextResponse.json({ count: 0, untriaged: 0 });
  }
}
