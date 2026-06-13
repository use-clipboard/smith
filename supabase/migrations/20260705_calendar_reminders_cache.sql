-- Calendar reminders cache: store each user's most recently fetched "next 24h"
-- Google Calendar events so the /api/calendar/reminders endpoint can serve them
-- from the database for a short window instead of calling Google on every hit.
--
-- That endpoint is hit by several consumers at once (dashboard hero + widget,
-- sidebar badge, the reminder banner), plus on every page load — each a slow
-- external call. A short-TTL cache (see lib/calendarReminders.ts) collapses
-- those into roughly one Google call per minute per user.

alter table calendar_tokens add column if not exists reminders_cache jsonb;
alter table calendar_tokens add column if not exists reminders_synced_at timestamptz;
