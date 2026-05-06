-- Tracks which timeout-condition edges have already fired a reminder,
-- so the daily cron never sends the same timeout email twice for the same step.

CREATE TABLE IF NOT EXISTS public.task_timeout_triggers (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  task_step_id   uuid        NOT NULL REFERENCES public.task_steps(id) ON DELETE CASCADE,
  edge_from_key  text        NOT NULL,  -- from_step_key of the triggering edge
  triggered_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (task_step_id, edge_from_key)
);

CREATE INDEX IF NOT EXISTS idx_timeout_triggers_step ON public.task_timeout_triggers(task_step_id);

ALTER TABLE public.task_timeout_triggers ENABLE ROW LEVEL SECURITY;
-- Service-role only — no user-facing RLS policy needed (cron job uses service role key)
