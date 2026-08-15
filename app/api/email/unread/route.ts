import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';
import { getRefreshedGmailClient } from '@/lib/gmail';
import { syncInboxCache, getUntriagedCount } from '@/lib/emailInboxCache';

export async function GET() {
  const ctx = await getUserContext();
  // Unexpected/transient (no session on a call from the logged-in shell): return
  // nulls so the client keeps its last good value instead of blanking to 0.
  if (!ctx) return NextResponse.json({ count: null, untriaged: null });

  // Stable states — the module is genuinely off / no mailbox connected — so 0 is
  // correct and should clear the badge.
  if (!ctx.activeModules.includes('email-triage')) {
    return NextResponse.json({ count: 0, untriaged: 0 });
  }

  const supabase = createClient();
  const { data: connection } = await supabase
    .from('email_connections')
    .select('refresh_token')
    .eq('user_id', ctx.userId)
    .single();

  if (!connection?.refresh_token) return NextResponse.json({ count: 0, untriaged: 0 });

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
    // null = "couldn't compute" so the client preserves its last good value
    // rather than flashing to 0 on a transient hiccup. A genuine 0 (everything
    // triaged) is returned as 0 and clears the badge.
    let untriaged: number | null = null;
    try {
      // Pass Gmail's authoritative INBOX message total so the sync can detect a
      // drifted cache (incremental history feed missed an event) and reconcile
      // it with a full rebuild — otherwise the untriaged count reads high.
      await syncInboxCache(ctx.userId, connection.refresh_token, label.data.messagesTotal ?? undefined);
      untriaged = await getUntriagedCount(ctx.userId);
    } catch { /* cache missing pre-migration / sync hiccup — keep last value */ }

    return NextResponse.json({ count, untriaged });
  } catch {
    // Transient Gmail/token error — return nulls so a momentary failure on one
    // of several concurrent callers can't blank the sidebar/dashboard counts.
    return NextResponse.json({ count: null, untriaged: null });
  }
}
