-- Enable Supabase Realtime push for notifications + tasks, so the bell, the
-- task badge, and the dashboard briefing/widgets update the instant a row
-- changes — replacing the 30s notification poll and 2-minute task poll.
--
-- REPLICA IDENTITY FULL so Realtime can evaluate RLS (and our user_id/firm
-- filters) on UPDATE/DELETE events, not just INSERT.
--
-- The publication adds are wrapped in DO/exception blocks: a table that's
-- already in the publication (or a missing publication) is a no-op, not an error
-- — matching the pattern used by the bookkeeping realtime migrations.

alter table public.notifications replica identity full;
alter table public.tasks         replica identity full;
alter table public.task_steps    replica identity full;

do $$ begin alter publication supabase_realtime add table public.notifications; exception when others then null; end $$;
do $$ begin alter publication supabase_realtime add table public.tasks;         exception when others then null; end $$;
do $$ begin alter publication supabase_realtime add table public.task_steps;    exception when others then null; end $$;
