-- ─── Tasks Schema ─────────────────────────────────────────────────────────────
-- Creates all task-related tables if they don't exist, and adds any missing
-- columns to existing tables. Safe to run multiple times (IF NOT EXISTS / IF NOT EXISTS).
-- Run this in the Supabase SQL Editor.

-- ── task_templates ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.task_templates (
  id                        uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id                   uuid        NOT NULL REFERENCES public.firms(id) ON DELETE CASCADE,
  created_by                uuid        REFERENCES public.users(id) ON DELETE SET NULL,
  name                      text        NOT NULL,
  description               text,
  is_firm_wide              boolean     NOT NULL DEFAULT true,
  category                  text        NOT NULL DEFAULT 'general',
  recurrence_type           text        CHECK (recurrence_type IN ('once','weekly','bi-weekly','monthly','quarterly','annually','custom')),
  recurrence_interval_days  int,
  estimated_duration_days   int,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now()
);

-- ── task_template_steps ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.task_template_steps (
  id                       uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id              uuid        NOT NULL REFERENCES public.task_templates(id) ON DELETE CASCADE,
  step_key                 text        NOT NULL,
  title                    text        NOT NULL,
  description              text,
  assignee_role            text        NOT NULL DEFAULT 'team_member' CHECK (assignee_role IN ('team_member','client','any')),
  default_assignee_id      uuid        REFERENCES public.users(id) ON DELETE SET NULL,
  tool_module_id           text,
  email_reminder_enabled   boolean     NOT NULL DEFAULT false,
  email_reminder_config    jsonb       NOT NULL DEFAULT '{"recipients":[],"timing":"on_assign"}'::jsonb,
  email_reminder_subject   text,
  email_reminder_message   text,
  client_instructions      text,
  client_can_upload        boolean     NOT NULL DEFAULT false,
  time_estimate_minutes    int,
  position_x               float       NOT NULL DEFAULT 200,
  position_y               float       NOT NULL DEFAULT 0,
  created_at               timestamptz NOT NULL DEFAULT now()
);

-- Add any columns that may be missing from an existing task_template_steps table
ALTER TABLE public.task_template_steps
  ADD COLUMN IF NOT EXISTS email_reminder_enabled  boolean     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS email_reminder_config   jsonb       NOT NULL DEFAULT '{"recipients":[],"timing":"on_assign"}'::jsonb,
  ADD COLUMN IF NOT EXISTS email_reminder_subject  text,
  ADD COLUMN IF NOT EXISTS email_reminder_message  text,
  ADD COLUMN IF NOT EXISTS client_instructions     text,
  ADD COLUMN IF NOT EXISTS client_can_upload       boolean     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS default_assignee_id     uuid        REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS tool_module_id          text,
  ADD COLUMN IF NOT EXISTS time_estimate_minutes   int;

-- ── task_template_edges ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.task_template_edges (
  id             uuid  PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id    uuid  NOT NULL REFERENCES public.task_templates(id) ON DELETE CASCADE,
  from_step_key  text  NOT NULL,
  to_step_key    text  NOT NULL,
  label          text
);

-- ── tasks ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.tasks (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id         uuid        NOT NULL REFERENCES public.firms(id) ON DELETE CASCADE,
  client_id       uuid        REFERENCES public.clients(id) ON DELETE SET NULL,
  created_by      uuid        REFERENCES public.users(id) ON DELETE SET NULL,
  template_id     uuid        REFERENCES public.task_templates(id) ON DELETE SET NULL,
  title           text        NOT NULL,
  description     text,
  status          text        NOT NULL DEFAULT 'not_started' CHECK (status IN ('not_started','in_progress','complete','on_hold','cancelled')),
  due_date        date,
  completed_at    timestamptz,
  recurrence_type text,
  recurrence_interval_days int,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- ── task_steps ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.task_steps (
  id                       uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id                  uuid        NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  template_step_id         uuid        REFERENCES public.task_template_steps(id) ON DELETE SET NULL,
  step_key                 text        NOT NULL,
  title                    text        NOT NULL,
  description              text,
  assignee_id              uuid        REFERENCES public.users(id) ON DELETE SET NULL,
  is_client_step           boolean     NOT NULL DEFAULT false,
  status                   text        NOT NULL DEFAULT 'not_started' CHECK (status IN ('not_started','in_progress','complete','blocked','skipped')),
  tool_module_id           text,
  tool_output_id           uuid,
  email_reminder_enabled   boolean     NOT NULL DEFAULT false,
  email_reminder_config    jsonb       NOT NULL DEFAULT '{"recipients":[],"timing":"on_assign"}'::jsonb,
  email_reminder_subject   text,
  email_reminder_message   text,
  client_instructions      text,
  client_can_upload        boolean     NOT NULL DEFAULT false,
  due_date                 date,
  completed_at             timestamptz,
  position_x               float       NOT NULL DEFAULT 200,
  position_y               float       NOT NULL DEFAULT 0,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now()
);

-- Add any columns that may be missing from an existing task_steps table
ALTER TABLE public.task_steps
  ADD COLUMN IF NOT EXISTS template_step_id       uuid        REFERENCES public.task_template_steps(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS email_reminder_enabled boolean     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS email_reminder_config  jsonb       NOT NULL DEFAULT '{"recipients":[],"timing":"on_assign"}'::jsonb,
  ADD COLUMN IF NOT EXISTS email_reminder_subject text,
  ADD COLUMN IF NOT EXISTS email_reminder_message text,
  ADD COLUMN IF NOT EXISTS client_instructions    text,
  ADD COLUMN IF NOT EXISTS client_can_upload      boolean     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS tool_output_id         uuid,
  ADD COLUMN IF NOT EXISTS is_client_step         boolean     NOT NULL DEFAULT false;

-- ── task_step_edges ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.task_step_edges (
  id             uuid  PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id        uuid  NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  from_step_key  text  NOT NULL,
  to_step_key    text  NOT NULL,
  label          text
);

-- ── task_time_entries ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.task_time_entries (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id     uuid        NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  step_id     uuid        REFERENCES public.task_steps(id) ON DELETE SET NULL,
  user_id     uuid        REFERENCES public.users(id) ON DELETE SET NULL,
  started_at  timestamptz NOT NULL,
  ended_at    timestamptz NOT NULL,
  notes       text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ── task_client_tokens ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.task_client_tokens (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  token        text        UNIQUE NOT NULL DEFAULT encode(gen_random_bytes(32), 'hex'),
  task_id      uuid        NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  step_id      uuid        NOT NULL REFERENCES public.task_steps(id) ON DELETE CASCADE,
  firm_id      uuid        NOT NULL REFERENCES public.firms(id) ON DELETE CASCADE,
  expires_at   timestamptz NOT NULL DEFAULT now() + interval '30 days',
  completed_at timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- ── Indexes ───────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_task_templates_firm       ON public.task_templates(firm_id);
CREATE INDEX IF NOT EXISTS idx_task_template_steps_tpl  ON public.task_template_steps(template_id);
CREATE INDEX IF NOT EXISTS idx_task_template_edges_tpl  ON public.task_template_edges(template_id);
CREATE INDEX IF NOT EXISTS idx_tasks_firm               ON public.tasks(firm_id);
CREATE INDEX IF NOT EXISTS idx_tasks_client             ON public.tasks(client_id);
CREATE INDEX IF NOT EXISTS idx_task_steps_task          ON public.task_steps(task_id);
CREATE INDEX IF NOT EXISTS idx_task_step_edges_task     ON public.task_step_edges(task_id);
CREATE INDEX IF NOT EXISTS idx_task_client_tokens_token ON public.task_client_tokens(token);
CREATE INDEX IF NOT EXISTS idx_task_client_tokens_step  ON public.task_client_tokens(step_id);

-- ── Row Level Security ────────────────────────────────────────────────────────
ALTER TABLE public.task_templates       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_template_steps  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_template_edges  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tasks                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_steps           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_step_edges      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_time_entries    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_client_tokens   ENABLE ROW LEVEL SECURITY;

-- Templates: firm members can manage their own firm's templates
CREATE POLICY IF NOT EXISTS "firm_access_task_templates"
  ON public.task_templates FOR ALL
  USING (firm_id IN (SELECT firm_id FROM public.users WHERE id = auth.uid()));

CREATE POLICY IF NOT EXISTS "firm_access_task_template_steps"
  ON public.task_template_steps FOR ALL
  USING (template_id IN (SELECT id FROM public.task_templates WHERE firm_id IN (SELECT firm_id FROM public.users WHERE id = auth.uid())));

CREATE POLICY IF NOT EXISTS "firm_access_task_template_edges"
  ON public.task_template_edges FOR ALL
  USING (template_id IN (SELECT id FROM public.task_templates WHERE firm_id IN (SELECT firm_id FROM public.users WHERE id = auth.uid())));

-- Tasks: firm members can manage their own firm's tasks
CREATE POLICY IF NOT EXISTS "firm_access_tasks"
  ON public.tasks FOR ALL
  USING (firm_id IN (SELECT firm_id FROM public.users WHERE id = auth.uid()));

CREATE POLICY IF NOT EXISTS "firm_access_task_steps"
  ON public.task_steps FOR ALL
  USING (task_id IN (SELECT id FROM public.tasks WHERE firm_id IN (SELECT firm_id FROM public.users WHERE id = auth.uid())));

CREATE POLICY IF NOT EXISTS "firm_access_task_step_edges"
  ON public.task_step_edges FOR ALL
  USING (task_id IN (SELECT id FROM public.tasks WHERE firm_id IN (SELECT firm_id FROM public.users WHERE id = auth.uid())));

CREATE POLICY IF NOT EXISTS "firm_access_task_time_entries"
  ON public.task_time_entries FOR ALL
  USING (task_id IN (SELECT id FROM public.tasks WHERE firm_id IN (SELECT firm_id FROM public.users WHERE id = auth.uid())));

CREATE POLICY IF NOT EXISTS "firm_access_task_client_tokens"
  ON public.task_client_tokens FOR ALL
  USING (firm_id IN (SELECT firm_id FROM public.users WHERE id = auth.uid()));
