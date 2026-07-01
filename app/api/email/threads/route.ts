import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';
import { getRefreshedGmailClient, parseGmailMessage, gmailRetry, isGmailRateLimitError, mapWithConcurrency, type EmailThread } from '@/lib/gmail';

// Cap simultaneous per-message Gmail calls so a single inbox page doesn't fire
// ~50 requests at once (a common rate-limit trigger).
const FETCH_CONCURRENCY = 8;

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
  const clientId = searchParams.get('clientId') || undefined; // filter to one client's allocated threads
  const category = searchParams.get('category') || undefined; // filter to one triage category's threads
  const sender = searchParams.get('sender') || undefined;     // post-filter DB results by sender email
  const timeParam = searchParams.get('time') || undefined;    // today | 7d | 30d — post-filter DB results
  const maxResults = 50;

  // ── DB-driven filters: task-linked / client-allocated / specific client ─────
  // These filters search the user's entire mailbox by joining against our DB
  // tables, then fetching only the matching threads from Gmail. They behave
  // like the unread filter (inbox-wide), but the data lives outside Gmail.
  // "untriaged" is an EXCLUSION filter (emails with no saved category), not a
  // DB id-set like the others — it's handled in the Gmail list paths below.
  const untriagedOnly = category === 'untriaged';
  const showAsThreads = connection.show_as_threads === true; // default false (ungrouped)

  // Per-user, per-email triage rows for a category filter. In flat view the
  // exact categorised EMAILS are fetched directly (dedicated branch below);
  // in threaded view they collapse to their threads for the id-set machinery.
  let categoryMessages: { id: string; threadId: string | null }[] | null = null;

  let restrictThreadIds: string[] | null = null;
  if (taskLinkedOnly || allocatedOnly || clientId || (category && !untriagedOnly)) {
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
    if (clientId) {
      const { data: allocs } = await supabase
        .from('email_allocations')
        .select('thread_id')
        .eq('firm_id', ctx.firmId)
        .eq('client_id', clientId);
      sets.push((allocs ?? []).map(r => r.thread_id as string));
    }
    if (category && !untriagedOnly) {
      // email_message_triage is service-role only (RLS, no policies) — the
      // user-scoped client reads 0 rows, so use the service client. A category
      // can hold thousands of emails (e.g. No Action Needed after auto-file)
      // but Supabase returns at most 1,000 rows and the fetch below caps at
      // 200 — order by most recently categorised so the slice is relevant.
      const svc = createServiceClient();
      const { data: cats } = await svc
        .from('email_message_triage')
        .select('message_id, thread_id')
        .eq('user_id', ctx.userId)
        .eq('category', category)
        .order('updated_at', { ascending: false })
        .limit(1000);
      categoryMessages = (cats ?? []).map(r => ({ id: r.message_id as string, threadId: (r.thread_id as string | null) ?? null }));
      if (showAsThreads) {
        sets.push(Array.from(new Set(categoryMessages.map(m => m.threadId).filter((x): x is string => !!x))));
      }
    }
    // Intersect across all active sets (so e.g. client + task-linked composes).
    // sets can legitimately be empty here (flat-view category-only filter —
    // handled by the dedicated branch below), in which case no thread-id
    // restriction applies.
    restrictThreadIds = sets.length === 0 ? null : (sets.reduce(
      (acc, s) => acc === null ? Array.from(new Set(s)) : acc.filter(id => s.includes(id)),
      null as string[] | null,
    ) ?? []);
  }

  try {
    const { gmail, accessToken } = await gmailRetry(() => getRefreshedGmailClient(connection.refresh_token));

    // For the untriaged filter, load every email this USER has categorised
    // (paged past the 1,000-row cap) — list results are filtered against
    // these sets, walking extra Gmail pages until a full page of untriaged
    // emails is collected. Flat view excludes by message id (exact); threaded
    // view excludes by thread id (a thread hides once any of its emails is
    // categorised — approximation for the non-default grouped mode).
    let categorisedIds: Set<string> | null = null;
    let categorisedThreadIds: Set<string> | null = null;
    if (untriagedOnly) {
      const svc = createServiceClient();
      categorisedIds = new Set<string>();
      categorisedThreadIds = new Set<string>();
      const PAGE = 1000;
      for (let from = 0; ; from += PAGE) {
        const { data } = await svc
          .from('email_message_triage')
          .select('message_id, thread_id')
          .eq('user_id', ctx.userId)
          .neq('category', 'untriaged')
          .range(from, from + PAGE - 1);
        for (const r of data ?? []) {
          categorisedIds.add(r.message_id as string);
          if (r.thread_id) categorisedThreadIds.add(r.thread_id as string);
        }
        if (!data || data.length < PAGE) break;
      }
    }
    // How many Gmail list pages the untriaged walk may scan in one request.
    // With a heavily-categorised inbox most items are skipped, so one request
    // can scan up to 10 × maxResults items; the returned nextPageToken lets
    // "Load more" continue the walk from where it stopped.
    const UNTRIAGED_SCAN_PAGES = 10;

    let threads: EmailThread[];
    let nextPageToken: string | null;

    // ── Flat-view category filter: fetch the user's categorised EMAILS ──────
    // Triage is per email, so in the (default) ungrouped view a category shows
    // exactly the messages the user put in it — fetched directly by message
    // id. Other DB filters (client / task-linked) intersect via thread id.
    if (!showAsThreads && categoryMessages) {
      let msgs = categoryMessages;
      if (restrictThreadIds !== null) {
        const allow = new Set(restrictThreadIds);
        msgs = msgs.filter(m => m.threadId && allow.has(m.threadId));
      }
      const ids = msgs.slice(0, 200).map(m => m.id); // safety cap
      threads = await mapWithConcurrency(ids, FETCH_CONCURRENCY,
        async (id): Promise<EmailThread> => {
          try {
            const msgRes = await gmailRetry(() => gmail.users.messages.get({
              userId: 'me',
              id,
              format: 'metadata',
              metadataHeaders: ['Subject', 'From', 'To', 'Date', 'Message-ID', 'References', 'In-Reply-To'],
            }), 2);
            const parsed = parseGmailMessage(msgRes.data as Parameters<typeof parseGmailMessage>[0]);
            return {
              id,
              gmailThreadId: msgRes.data.threadId ?? id,
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
              id,
              gmailThreadId: id,
              subject: '(unavailable)',
              snippet: '',
              from: { name: '', email: '' },
              date: '',
              messageCount: 1,
              isRead: true,
              labelIds: [],
              messages: [],
            };
          }
        }
      );
      threads.sort((a, b) => (new Date(b.date).getTime() || 0) - (new Date(a.date).getTime() || 0));
      // Drafts never appear in triage views; sender/time post-filter the set.
      // Inbox-scope it too: an email that's been trashed / archived since it was
      // categorised has left the inbox, so it drops off the category's list
      // (matches the inbox-scoped card count). Uses the live Gmail labels we just
      // fetched, so it's exact — not dependent on the cache.
      let dbMsgs = threads.filter(t => !t.labelIds?.includes('DRAFT') && (t.labelIds?.includes('INBOX') ?? false));
      if (sender) {
        const s = sender.toLowerCase();
        dbMsgs = dbMsgs.filter(t => (t.from?.email ?? '').toLowerCase() === s);
      }
      if (timeParam && timeParam !== 'all') {
        const now = Date.now();
        const today0 = new Date(); today0.setHours(0, 0, 0, 0);
        const cutoff = timeParam === 'today' ? today0.getTime()
          : timeParam === '7d' ? now - 7 * 86_400_000
          : timeParam === '30d' ? now - 30 * 86_400_000 : 0;
        if (cutoff) dbMsgs = dbMsgs.filter(t => { const d = new Date(t.date).getTime(); return !Number.isNaN(d) && d >= cutoff; });
      }
      await supabase
        .from('email_connections')
        .update({ access_token: accessToken, updated_at: new Date().toISOString() })
        .eq('user_id', ctx.userId);
      return NextResponse.json({ threads: dbMsgs, nextPageToken: null });
    }

    // When DB filters are active, bypass Gmail's list/search and fetch each
    // matching thread directly. Pagination is dropped — these sets are bounded
    // by what the firm has linked, typically far smaller than an inbox page.
    if (restrictThreadIds !== null) {
      nextPageToken = null;
      const ids = restrictThreadIds.slice(0, 200); // safety cap
      threads = await mapWithConcurrency(ids, FETCH_CONCURRENCY,
        async (id): Promise<EmailThread> => {
          try {
            const threadRes = await gmailRetry(() => gmail.users.threads.get({
              userId: 'me',
              id,
              format: 'metadata',
              metadataHeaders: ['Subject', 'From', 'To', 'Date', 'Message-ID', 'References', 'In-Reply-To'],
            }), 2);
            const messages = (threadRes.data.messages ?? []).map(m =>
              parseGmailMessage(m as Parameters<typeof parseGmailMessage>[0])
            );
            const first = messages[0];
            const last = messages[messages.length - 1];
            const hasUnread = messages.some(m => !m.isRead);
            const allLabelIds = Array.from(new Set(messages.flatMap(m => m.labelIds)));
            const base = {
              subject: first?.subject ?? '(no subject)',
              snippet: threadRes.data.snippet ?? '',
              from: last?.from ?? { name: '', email: '' },
              date: last?.date ?? first?.date ?? '',
              messageCount: messages.length,
              isRead: !hasUnread,
              labelIds: allLabelIds,
              messages,
            };
            // In ungrouped (flat) view, key the row by the latest message and
            // carry the real thread id in gmailThreadId — so the reader shows
            // that single message (matching the main inbox), not the whole
            // collapsible conversation. In grouped view, key by thread id.
            return (!showAsThreads && last)
              ? { id: last.id, gmailThreadId: id, ...base }
              : { id, ...base };
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
        }
      );
      // Most recent first
      threads.sort((a, b) => (new Date(b.date).getTime() || 0) - (new Date(a.date).getTime() || 0));

      // Drafts must never appear in triage-derived views (category / allocated /
      // client filters) — they belong in the Drafts folder and open into compose.
      let dbThreads = threads.filter(t => !t.labelIds?.includes('DRAFT'));
      if (sender) {
        const s = sender.toLowerCase();
        dbThreads = dbThreads.filter(t => (t.from?.email ?? '').toLowerCase() === s);
      }
      if (timeParam && timeParam !== 'all') {
        const now = Date.now();
        const today0 = new Date(); today0.setHours(0, 0, 0, 0);
        const cutoff = timeParam === 'today' ? today0.getTime()
          : timeParam === '7d' ? now - 7 * 86_400_000
          : timeParam === '30d' ? now - 30 * 86_400_000 : 0;
        if (cutoff) dbThreads = dbThreads.filter(t => { const d = new Date(t.date).getTime(); return !Number.isNaN(d) && d >= cutoff; });
      }

      await supabase
        .from('email_connections')
        .update({ access_token: accessToken, updated_at: new Date().toISOString() })
        .eq('user_id', ctx.userId);

      return NextResponse.json({ threads: dbThreads, nextPageToken });
    }

    if (showAsThreads) {
      // ── Threaded mode: group messages into conversations ──────────────────
      let threadItems: { id?: string | null }[] = [];
      if (categorisedIds) {
        // Untriaged: walk pages, skipping categorised threads, until a full
        // page of untriaged conversations is collected (or pages run out).
        let token: string | undefined = pageToken;
        nextPageToken = null;
        for (let page = 0; page < UNTRIAGED_SCAN_PAGES; page++) {
          const listRes = await gmailRetry(() => gmail.users.threads.list({
            userId: 'me',
            ...(q ? { q } : { labelIds: [label] }),
            maxResults,
            pageToken: token,
          }));
          threadItems.push(...(listRes.data.threads ?? []).filter(t => t.id && !categorisedThreadIds!.has(t.id)));
          token = listRes.data.nextPageToken ?? undefined;
          if (!token || threadItems.length >= maxResults) break;
        }
        threadItems = threadItems.slice(0, maxResults);
        nextPageToken = token ?? null;
      } else {
        const listRes = await gmailRetry(() => gmail.users.threads.list({
          userId: 'me',
          ...(q ? { q } : { labelIds: [label] }),
          maxResults,
          pageToken,
        }));
        threadItems = listRes.data.threads ?? [];
        nextPageToken = listRes.data.nextPageToken ?? null;
      }

      threads = await mapWithConcurrency(threadItems, FETCH_CONCURRENCY,
        async (t): Promise<EmailThread> => {
          try {
            const threadRes = await gmailRetry(() => gmail.users.threads.get({
              userId: 'me',
              id: t.id!,
              format: 'metadata',
              metadataHeaders: ['Subject', 'From', 'To', 'Date', 'Message-ID', 'References', 'In-Reply-To'],
            }), 2);

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
        }
      );
    } else {
      // ── Non-threaded mode: each message is its own list item ──────────────
      let msgItems: { id?: string | null; threadId?: string | null }[] = [];
      if (categorisedIds) {
        // Untriaged: walk pages, skipping messages whose thread is already
        // categorised, until a full page of untriaged messages is collected.
        let token: string | undefined = pageToken;
        nextPageToken = null;
        for (let page = 0; page < UNTRIAGED_SCAN_PAGES; page++) {
          const listRes = await gmailRetry(() => gmail.users.messages.list({
            userId: 'me',
            ...(q ? { q } : { labelIds: [label] }),
            maxResults,
            pageToken: token,
          }));
          msgItems.push(...(listRes.data.messages ?? []).filter(m => !categorisedIds!.has(m.id ?? '')));
          token = listRes.data.nextPageToken ?? undefined;
          if (!token || msgItems.length >= maxResults) break;
        }
        msgItems = msgItems.slice(0, maxResults);
        nextPageToken = token ?? null;
      } else {
        const listRes = await gmailRetry(() => gmail.users.messages.list({
          userId: 'me',
          ...(q ? { q } : { labelIds: [label] }),
          maxResults,
          pageToken,
        }));
        msgItems = listRes.data.messages ?? [];
        nextPageToken = listRes.data.nextPageToken ?? null;
      }

      threads = await mapWithConcurrency(msgItems, FETCH_CONCURRENCY,
        async (m): Promise<EmailThread> => {
          try {
            const msgRes = await gmailRetry(() => gmail.users.messages.get({
              userId: 'me',
              id: m.id!,
              format: 'metadata',
              metadataHeaders: ['Subject', 'From', 'To', 'Date', 'Message-ID', 'References', 'In-Reply-To'],
            }), 2);

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
        }
      );
    }

    // Update access token in DB
    await supabase
      .from('email_connections')
      .update({ access_token: accessToken, updated_at: new Date().toISOString() })
      .eq('user_id', ctx.userId);

    return NextResponse.json({ threads, nextPageToken });
  } catch (err) {
    // Gmail rate limit → return 429 (not 500) so it's not flagged as a server
    // error, and the client can quietly back off and retry on the next poll.
    if (isGmailRateLimitError(err)) {
      console.warn('Email threads: Gmail rate limit, returning 429');
      return NextResponse.json(
        { error: 'Gmail is busy (rate limit). Please retry shortly.', rateLimited: true },
        { status: 429, headers: { 'Retry-After': '30' } },
      );
    }
    const message = err instanceof Error ? err.message : String(err);
    console.error('Email threads fetch error:', message);
    return NextResponse.json({ error: message || 'Failed to fetch emails' }, { status: 500 });
  }
}
