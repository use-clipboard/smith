-- ─── Agent Smith ─────────────────────────────────────────────────────────────
-- Powers admin-only agentic actions inside the Ask Smith UI: mass mutations,
-- reports, and read-only queries on firm data. Every mutation is snapshotted
-- so any admin can one-click undo within 24 hours.

-- Per-firm settings + daily usage counters
CREATE TABLE IF NOT EXISTS public.agent_settings (
  firm_id                  uuid        PRIMARY KEY REFERENCES public.firms(id) ON DELETE CASCADE,
  enabled                  boolean     NOT NULL DEFAULT true,
  daily_input_token_cap    integer     NOT NULL DEFAULT 200000,
  daily_output_token_cap   integer     NOT NULL DEFAULT 50000,
  -- Rolling 24h usage; reset by the chat endpoint when window expires
  usage_input_tokens       integer     NOT NULL DEFAULT 0,
  usage_output_tokens      integer     NOT NULL DEFAULT 0,
  usage_window_started_at  timestamptz NOT NULL DEFAULT now(),
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now()
);

-- One row per agent-applied mutation (the "action" the user confirmed).
-- `snapshot` contains the JSON before-image for every affected row, indexed
-- by table → array of {row}. Undo replays these to restore state.
CREATE TABLE IF NOT EXISTS public.agent_actions (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id           uuid        NOT NULL REFERENCES public.firms(id) ON DELETE CASCADE,
  performed_by      uuid        REFERENCES public.users(id) ON DELETE SET NULL,
  action_type       text        NOT NULL,         -- e.g. 'task_bulk_update', 'client_bulk_update'
  summary           text        NOT NULL,         -- one-liner for audit & notification
  plain_description text,                         -- agent's longer English description
  affected_count    integer     NOT NULL DEFAULT 0,
  snapshot          jsonb       NOT NULL DEFAULT '{}'::jsonb,
  applied_at        timestamptz NOT NULL DEFAULT now(),
  expires_at        timestamptz NOT NULL DEFAULT now() + interval '24 hours',
  undone_at         timestamptz,
  undone_by         uuid        REFERENCES public.users(id) ON DELETE SET NULL,
  undo_error        text                          -- non-null if undo failed
);

CREATE INDEX IF NOT EXISTS idx_agent_actions_firm
  ON public.agent_actions(firm_id, applied_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_actions_pending_undo
  ON public.agent_actions(firm_id) WHERE undone_at IS NULL;

ALTER TABLE public.agent_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_actions  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "firm_access_agent_settings" ON public.agent_settings;
CREATE POLICY "firm_access_agent_settings"
  ON public.agent_settings FOR ALL
  USING (firm_id IN (SELECT firm_id FROM public.users WHERE id = auth.uid()));

DROP POLICY IF EXISTS "firm_access_agent_actions" ON public.agent_actions;
CREATE POLICY "firm_access_agent_actions"
  ON public.agent_actions FOR ALL
  USING (firm_id IN (SELECT firm_id FROM public.users WHERE id = auth.uid()));
