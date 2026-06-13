/**
 * Cached "next 24 hours" calendar reminders.
 *
 * /api/calendar/reminders is hit by several consumers — the dashboard hero +
 * widget, the sidebar calendar badge, and the reminder banner — and on every
 * page load. Each call previously fetched the user's events straight from
 * Google (slow, external). This helper puts a short-TTL cache in front:
 *
 *   • Fresh (< TTL since last sync) → serve the cached events from the DB.
 *   • Stale/empty → fetch from Google once, store, and return.
 *   • Concurrent callers share a single in-flight fetch (no thundering herd on
 *     first load, when 3+ consumers ask at the same moment).
 *   • If Google errors, serve the last good cache rather than nothing.
 *
 * The cache lives on calendar_tokens (reminders_cache / reminders_synced_at).
 * TTL is deliberately short so newly-created meetings still surface promptly.
 */

import { createClient } from '@/lib/supabase-server';
import { fetchUserEvents } from '@/lib/googleCalendar';

const TTL_MS = 60_000; // 1 minute — short enough that new meetings appear quickly

export interface ReminderEvent {
  id: string;
  title: string;
  start: string;
  end: string;
  htmlLink?: string;
  meetLink?: string;
}
export interface RemindersResult {
  events: ReminderEvent[];
  connected: boolean;
}

// Share one in-flight fetch per user within this process, so the burst of
// simultaneous consumers on first load triggers a single Google call.
const inFlight = new Map<string, Promise<RemindersResult>>();

export async function getUpcomingReminders(userId: string): Promise<RemindersResult> {
  const existing = inFlight.get(userId);
  if (existing) return existing;

  const run = (async (): Promise<RemindersResult> => {
    const supabase = createClient();

    // Read tokens + cache. If the cache columns don't exist yet (migration not
    // run), fall back to a tokens-only read and skip caching — so calendar
    // reminders keep working rather than breaking app-wide.
    let cacheReady = true;
    let tok: {
      google_access_token: string | null;
      google_refresh_token: string | null;
      reminders_cache?: unknown;
      reminders_synced_at?: string | null;
    } | null = null;

    const full = await supabase
      .from('calendar_tokens')
      .select('google_access_token, google_refresh_token, reminders_cache, reminders_synced_at')
      .eq('user_id', userId)
      .single();
    if (full.error && full.error.code === '42703') {
      cacheReady = false;
      const basic = await supabase
        .from('calendar_tokens')
        .select('google_access_token, google_refresh_token')
        .eq('user_id', userId)
        .single();
      tok = basic.data;
    } else {
      tok = full.data;
    }

    if (!tok?.google_refresh_token) return { events: [], connected: false };

    // Serve a fresh cache without touching Google.
    const syncedAt = tok.reminders_synced_at ? new Date(tok.reminders_synced_at).getTime() : 0;
    if (cacheReady && tok.reminders_cache && Date.now() - syncedAt < TTL_MS) {
      return { events: (tok.reminders_cache as ReminderEvent[]) ?? [], connected: true };
    }

    // Cache miss → fetch the next 24h from Google, then store.
    try {
      const now = new Date();
      const end = new Date(now.getTime() + 24 * 60 * 60 * 1000);
      const { events, newAccessToken } = await fetchUserEvents(
        tok.google_access_token ?? '',
        tok.google_refresh_token,
        now.toISOString(),
        end.toISOString(),
      );

      // Only timed (non all-day) events, with the fields the consumers need.
      const upcoming: ReminderEvent[] = events
        .filter(e => e.start.includes('T'))
        .map(e => ({ id: e.id, title: e.title, start: e.start, end: e.end, htmlLink: e.htmlLink, meetLink: e.meetLink }));

      const update: Record<string, unknown> = cacheReady
        ? { reminders_cache: upcoming, reminders_synced_at: new Date().toISOString() }
        : {};
      if (newAccessToken && newAccessToken !== tok.google_access_token) {
        update.google_access_token = newAccessToken;
        update.updated_at = new Date().toISOString();
      }
      if (Object.keys(update).length > 0) {
        await supabase.from('calendar_tokens').update(update).eq('user_id', userId);
      }

      return { events: upcoming, connected: true };
    } catch (err) {
      console.error('Calendar reminders fetch error:', err);
      // Degrade to the last good cache if we have one.
      if (tok.reminders_cache) return { events: tok.reminders_cache as ReminderEvent[], connected: true };
      return { events: [], connected: true };
    }
  })().finally(() => inFlight.delete(userId));

  inFlight.set(userId, run);
  return run;
}
