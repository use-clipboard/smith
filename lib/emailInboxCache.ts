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
// When the cache size disagrees with Gmail's INBOX total we force a full
// rebuild, but at most once per this window so a steady 60s poll (or a user
// whose inbox legitimately exceeds the rebuild page cap) can't trigger a 25-
// request rebuild every cycle. Drift heals within one cooldown at worst.
const DRIFT_REBUILD_COOLDOWN_MS = 5 * 60_000;

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

  // Reconcile the cache WITHOUT ever emptying it. A wholesale
  // DELETE-then-INSERT leaves a window in which the cache has no rows, and any
  // read of email_untriaged_count() during that window returns 0 — which flashed
  // the sidebar/dashboard untriaged badge to zero on every (drift-triggered)
  // rebuild. Instead: upsert the fresh listing first (idempotent), THEN delete
  // only the ids that are no longer in the inbox. The cache stays populated
  // throughout, so the count can at worst be momentarily a little high (a few
  // not-yet-removed stale ids) — never 0. Upsert (not insert) also keeps two
  // racing rebuilds across serverless instances converging on primary-key
  // conflicts instead of failing.
  // Read ALL currently-cached ids (paged — a single PostgREST select caps at
  // ~1000 rows, and a large inbox has more), so we can prune exactly the ids
  // that have left the inbox without missing any.
  const existingIds = new Set<string>();
  for (let from = 0; ; from += CHUNK) {
    const { data: page } = await svc
      .from('email_inbox_cache').select('message_id')
      .eq('user_id', userId).range(from, from + CHUNK - 1);
    const batch = page ?? [];
    for (const r of batch) existingIds.add(r.message_id as string);
    if (batch.length < CHUNK) break;
  }
  const freshIds = new Set(rows.map(r => r.message_id));

  // Guard: an empty inbox listing when the cache was populated is almost always
  // a transient Gmail glitch, not a genuinely emptied inbox. Never let that wipe
  // a populated cache — it would zero the untriaged count. Leave it untouched.
  if (rows.length === 0 && existingIds.size > 0) return startHistoryId;

  const staleIds = [...existingIds].filter(id => !freshIds.has(id));

  // Upsert the fresh listing first (cache is never empty), THEN remove stale ids.
  for (let i = 0; i < rows.length; i += CHUNK) {
    await svc.from('email_inbox_cache').upsert(rows.slice(i, i + CHUNK), { onConflict: 'user_id,message_id' });
  }
  for (let i = 0; i < staleIds.length; i += CHUNK) {
    await svc.from('email_inbox_cache')
      .delete().eq('user_id', userId).in('message_id', staleIds.slice(i, i + CHUNK));
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
export async function syncInboxCache(
  userId: string,
  refreshToken: string,
  // Gmail's authoritative INBOX message total (from labels.get) when the caller
  // already has it. Lets us detect cache drift for free and reconcile it.
  expectedInboxTotal?: number,
): Promise<void> {
  const existing = inFlight.get(userId);
  if (existing) return existing;

  const run = (async () => {
    const svc = createServiceClient();

    const { data: conn } = await svc
      .from('email_connections').select('history_id, inbox_rebuilt_at').eq('user_id', userId).single();
    const { count: cacheCount } = await svc
      .from('email_inbox_cache').select('message_id', { count: 'exact', head: true }).eq('user_id', userId);

    const { gmail } = await getRefreshedGmailClient(refreshToken);

    const haveBookmark = !!conn?.history_id && (cacheCount ?? 0) > 0;

    // Drift safety-net: if the cached inbox size disagrees with Gmail's own
    // INBOX total, the incremental history feed has missed an event and the
    // count is wrong — force a full rebuild to reconcile. Rate-limited via
    // inbox_rebuilt_at (NOT inbox_synced_at, which every sync bumps).
    let forceRebuild = false;
    if (typeof expectedInboxTotal === 'number' && (cacheCount ?? 0) !== expectedInboxTotal) {
      const lastRebuild = conn?.inbox_rebuilt_at ? Date.parse(conn.inbox_rebuilt_at as string) : 0;
      if (Date.now() - lastRebuild > DRIFT_REBUILD_COOLDOWN_MS) forceRebuild = true;
    }

    let newHistoryId: string | null = null;
    let didRebuild = false;

    if (haveBookmark && !forceRebuild) {
      newHistoryId = await incremental(svc, gmail, userId, conn!.history_id as string);
    }
    if (!haveBookmark || forceRebuild || newHistoryId === null) {
      newHistoryId = await fullRebuild(svc, gmail, userId);
      didRebuild = true;
    }

    await svc.from('email_connections').update({
      history_id: newHistoryId ?? conn?.history_id ?? null,
      inbox_synced_at: new Date().toISOString(),
      ...(didRebuild ? { inbox_rebuilt_at: new Date().toISOString() } : {}),
    }).eq('user_id', userId);
  })().finally(() => inFlight.delete(userId));

  inFlight.set(userId, run);
  return run;
}

/**
 * Fast untriaged count straight from the DB (cache minus categorised). Returns
 * null — meaning "couldn't compute" — on an RPC error, so callers can preserve
 * the last good value rather than blanking the badge to a misleading 0. A
 * genuine 0 (everything triaged) still comes back as 0.
 */
export async function getUntriagedCount(userId: string): Promise<number | null> {
  const svc = createServiceClient();
  const { data, error } = await svc.rpc('email_untriaged_count', { p_user_id: userId });
  if (error || typeof data !== 'number') return null;
  return data;
}
