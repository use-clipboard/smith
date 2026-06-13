import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';
import { getRefreshedGmailClient } from '@/lib/gmail';
import { syncInboxCache, getUntriagedCount } from '@/lib/emailInboxCache';

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

    // Untriaged = inbox EMAILS the caller hasn't categorised. Rather than
    // re-listing the whole inbox from Gmail every call, we keep a server-side
    // cache of inbox message ids fresh (incrementally, via the Gmail history
    // API) and compute the count from the DB: cache minus this user's
    // non-"untriaged" triage rows. Triage stays live, so re-categorising any
    // email — however old — is reflected on the next read.
    let untriaged = 0;
    try {
      await syncInboxCache(ctx.userId, connection.refresh_token);
      untriaged = await getUntriagedCount(ctx.userId);
    } catch { /* cache missing pre-migration / sync hiccup — badge just hides */ }

    return NextResponse.json({ count, untriaged });
  } catch {
    return NextResponse.json({ count: 0, untriaged: 0 });
  }
}
