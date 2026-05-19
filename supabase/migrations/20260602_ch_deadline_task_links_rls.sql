-- CH Secretarial — deadline link RLS policy
--
-- The table was created in 20260529 without RLS policies. Supabase's default
-- on new tables is RLS enabled (no policies = no rows visible) so reads via
-- the anon (logged-in user) client were returning empty even though inserts
-- via the service role succeeded. The result: the tasks-page inline link
-- icon never appeared, and the backfill route reported `linked=1000` but a
-- subsequent COUNT showed 0.
--
-- This migration enables RLS explicitly + adds a firm-scoped policy that
-- mirrors the one on `public.tasks` (20260430_tasks_schema.sql): a user
-- sees / changes only links whose firm_id matches their own firm_id.

ALTER TABLE public.ch_deadline_task_links ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "firm_access_ch_deadline_task_links" ON public.ch_deadline_task_links;

CREATE POLICY "firm_access_ch_deadline_task_links"
  ON public.ch_deadline_task_links FOR ALL
  USING  (firm_id IN (SELECT firm_id FROM public.users WHERE id = auth.uid()))
  WITH CHECK (firm_id IN (SELECT firm_id FROM public.users WHERE id = auth.uid()));
