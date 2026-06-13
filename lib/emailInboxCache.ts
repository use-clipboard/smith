/**
 * Inbox cache sync — keeps the `email_inbox_cache` table in step with the user's
 * Gmail inbox so the untriaged count can be read from the database instead of
 * re-listing the whole inbox from Gmail on every request.
 *
 * Strategy:
 *   • Incremental (the common path) — ask Gmail "what changed since the bookmark
 *     (email_connections.history_id)?" via users.history.list and apply just the
 *     deltas (messages added / removed / inbox label added / removed). One cheap
 *     request instead of paging the entire inbox.
 *   • Full rebuild (first connect, no bookmark, or an expired bookmark) — page
 *     the whole inbox once and replace the cache. Self-healing: an expired
 *     bookmark (Gmail 404) automatically falls back to a rebuild.
 *
 * All cache writes are idempotent (upsert / delete-if-present), so overlapping
 * syncs or a rebuild→incremental overlap converge rather than corrupt.
 *
 * Triage categories are deliberately NOT cached here — they live in
 * email_message_triage and are read live by email_untriaged_count(), so a
 * re-categorisation (even of a very old email) is reflected immediately.
 */

import { createServiceClient } from '@/lib/supabase-server';
import { getRefreshedGmailClient, gmailRetry } from '@/lib/gmail';

type ServiceClient = ReturnType<typeof createServiceClient>;
type Gmail = Awaited<ReturnType<typeof getRefreshedGmailClient>>['gmail'];

const INBOX = 'INBOX';
const CHUNK = 1000; // rows per DB insert/upsert batch

// De-duplicate concurrent syncs for the same user within this process: first
// load fires several /api/email/unread calls at once, and we must not let them
// all start their own full rebuild (they'd race on the cache table). Callers
// that arrive while a sync is running await the same in-flight promise.
const inFlight = new Map<string, Promise<void>>();

/** Gmail returns 404 from history.list when the startHistoryId is too old. */
function isHistoryExpired(err: unknown): boolean {
  const e = err as { code?: number; status?: number; response?: { status?: number } };
  const status = e?.code ?? e?.status ?? e?.response?.status;
  return status === 404;
}

/**
 * Full scan: enumerate every INBOX message id and replace the user's cache.
 * Returns the historyId to bookmark from. We capture it BEFORE listing so any
 * change that happens during the (slow) scan is replayed by the next
 * incremental sync — safe because all writes are idempotent.
 */
async function fullRebuild(svc: ServiceClient, gmail: Gmail, userId: string): Promise<string | null> {
  const profile = await gmailRetry(() => gmail.users.getProfile({ userId: 'me' }));
  const startHistoryId = profile.data.historyId ?? null;

  const rows: { user_id: string; message_id: string; thread_id: string | null }[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < 25; page++) { // up to 25 × 500 = 12,500 messages
    const res = await gmailRetry(() => gmail.users.messages.list({
      userId: 'me', labelIds: [INBOX], maxResults: 500, pageToken,
    }));
    for (const m of res.data.messages ?? []) {
      if (m.id) rows.push({ user_id: userId, message_id: m.id, thread_id: m.threadId ?? null });
    }
    pageToken = res.data.nextPageToken ?? undefined;
    if (!pageToken) break;
  }

  // Replace the cache wholesale: clear the user's rows, then upsert the fresh
  // listing. Upsert (not insert) so that if two rebuilds ever race — across
  // serverless instances, where the in-process lock can't help — they write the
  // same rows and converge instead of failing on primary-key conflicts.
  await svc.from('email_inbox_cache').delete().eq('user_id', userId);
  for (let i = 0; i < rows.length; i += CHUNK) {
    await svc.from('email_inbox_cache').upsert(rows.slice(i, i + CHUNK), { onConflict: 'user_id,message_id' });
  }
  return startHistoryId;
}

/**
 * Incremental: apply Gmail history deltas since `startHistoryId`. Returns the
 * new historyId, or null if the bookmark has expired (caller should rebuild).
 */
async function incremental(
  svc: ServiceClient, gmail: Gmail, userId: string, startHistoryId: string,
): Promise<string | null> {
  const toAdd = new Map<string, string | null>(); // message_id -> thread_id
  const toRemove = new Set<string>();
  let latest = startHistoryId;
  let pageToken: string | undefined;

  try {
    for (let page = 0; page < 50; page++) {
      const res = await gmailRetry(() => gmail.users.history.list({
        userId: 'me',
        startHistoryId,
        pageToken,
        labelId: INBOX, // only history that touches the inbox label
        historyTypes: ['messageAdded', 'messageDeleted', 'labelAdded', 'labelRemoved'],
      }));
      if (res.data.historyId) latest = res.data.historyId;

      for (const h of res.data.history ?? []) {
        // New messages that landed in the inbox.
        for (const ma of h.messagesAdded ?? []) {
          const msg = ma.message;
          if (msg?.id && (msg.labelIds ?? []).includes(INBOX)) {
            toAdd.set(msg.id, msg.threadId ?? null); toRemove.delete(msg.id);
          }
        }
        // Messages deleted outright.
        for (const md of h.messagesDeleted ?? []) {
          const id = md.message?.id;
          if (id) { toRemove.add(id); toAdd.delete(id); }
        }
        // INBOX label added (e.g. un-archived / moved back to inbox).
        for (const la of h.labelsAdded ?? []) {
          const msg = la.message;
          if (msg?.id && (la.labelIds ?? []).includes(INBOX)) {
            toAdd.set(msg.id, msg.threadId ?? null); toRemove.delete(msg.id);
          }
        }
        // INBOX label removed (archived) — no longer an inbox email.
        for (const lr of h.labelsRemoved ?? []) {
          const msg = lr.message;
          if (msg?.id && (lr.labelIds ?? []).includes(INBOX)) {
            toRemove.add(msg.id); toAdd.delete(msg.id);
          }
        }
      }

      pageToken = res.data.nextPageToken ?? undefined;
      if (!pageToken) break;
    }
  } catch (err) {
    if (isHistoryExpired(err)) return null; // signal a full rebuild
    throw err;
  }

  if (toRemove.size > 0) {
    await svc.from('email_inbox_cache')
      .delete().eq('user_id', userId).in('message_id', [...toRemove]);
  }
  if (toAdd.size > 0) {
    const rows = [...toAdd.entries()].map(([message_id, thread_id]) => ({ user_id: userId, message_id, thread_id }));
    for (let i = 0; i < rows.length; i += CHUNK) {
      await svc.from('email_inbox_cache')
        .upsert(rows.slice(i, i + CHUNK), { onConflict: 'user_id,message_id' });
    }
  }
  return latest;
}

/**
 * Bring the user's inbox cache up to date. Incremental when we have a usable
 * bookmark + existing cache, otherwise a full rebuild. Best-effort: throws only
 * on unexpected errors so callers can degrade gracefully.
 */
export async function syncInboxCache(userId: string, refreshToken: string): Promise<void> {
  const existing = inFlight.get(userId);
  if (existing) return existing;

  const run = (async () => {
    const svc = createServiceClient();

    const { data: conn } = await svc
      .from('email_connections').select('history_id').eq('user_id', userId).single();
    const { count: cacheCount } = await svc
      .from('email_inbox_cache').select('message_id', { count: 'exact', head: true }).eq('user_id', userId);

    const { gmail } = await getRefreshedGmailClient(refreshToken);

    const haveBookmark = !!conn?.history_id && (cacheCount ?? 0) > 0;
    let newHistoryId: string | null = null;

    if (haveBookmark) {
      newHistoryId = await incremental(svc, gmail, userId, conn!.history_id as string);
    }
    if (!haveBookmark || newHistoryId === null) {
      newHistoryId = await fullRebuild(svc, gmail, userId);
    }

    await svc.from('email_connections').update({
      history_id: newHistoryId ?? conn?.history_id ?? null,
      inbox_synced_at: new Date().toISOString(),
    }).eq('user_id', userId);
  })().finally(() => inFlight.delete(userId));

  inFlight.set(userId, run);
  return run;
}

/** Fast untriaged count straight from the DB (cache minus categorised). */
export async function getUntriagedCount(userId: string): Promise<number> {
  const svc = createServiceClient();
  const { data, error } = await svc.rpc('email_untriaged_count', { p_user_id: userId });
  if (error || typeof data !== 'number') return 0;
  return data;
}
