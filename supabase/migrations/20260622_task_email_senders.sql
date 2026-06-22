-- ─── Task email senders ──────────────────────────────────────────────────────
-- Lets task emails (reminders + client task request/completion) be sent from a
-- connected Gmail — either the task owner's mailbox or a specific firm mailbox —
-- instead of Resend. Safe to run multiple times.
--
-- Resolution at send time: task.email_sender_mode → (if 'default') firm default →
-- 'owner' (the team member who owns the task) or 'specific' (a firm mailbox).
-- If the resolved sender isn't connected, the email is NOT sent and the owner is
-- flagged (no Resend fallback for task emails).

-- 1. Firm-level connected sending mailboxes (a firm can connect several).
--    refresh_token is SERVICE-ROLE ONLY — no client-readable RLS policy is added,
--    so the anon/auth key can never read tokens. The UI lists metadata via a
--    server route using the service client (mirrors hmrc_connections / email_connections).
CREATE TABLE IF NOT EXISTS public.firm_sending_mailboxes (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id       uuid        NOT NULL REFERENCES public.firms(id) ON DELETE CASCADE,
  google_email  text        NOT NULL,
  label         text,
  refresh_token text        NOT NULL,
  connected_by  uuid        REFERENCES public.users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (firm_id, google_email)
);
CREATE INDEX IF NOT EXISTS idx_firm_sending_mailboxes_firm ON public.firm_sending_mailboxes(firm_id);
ALTER TABLE public.firm_sending_mailboxes ENABLE ROW LEVEL SECURITY;
-- Intentionally NO policies: only the service role (server) may read/write,
-- because rows hold refresh tokens.

-- 2. Firm default sender (where a template says 'use firm default').
ALTER TABLE public.firms
  ADD COLUMN IF NOT EXISTS task_email_sender_mode        text NOT NULL DEFAULT 'owner'
    CHECK (task_email_sender_mode IN ('owner','specific')),
  ADD COLUMN IF NOT EXISTS task_email_sender_mailbox_id  uuid REFERENCES public.firm_sending_mailboxes(id) ON DELETE SET NULL;

-- 3. Per-template sender choice ('default' inherits the firm default).
ALTER TABLE public.task_templates
  ADD COLUMN IF NOT EXISTS email_sender_mode       text NOT NULL DEFAULT 'default'
    CHECK (email_sender_mode IN ('default','owner','specific')),
  ADD COLUMN IF NOT EXISTS email_sender_mailbox_id uuid REFERENCES public.firm_sending_mailboxes(id) ON DELETE SET NULL;

-- 4. Per-task sender choice (copied from the template when a task is created;
--    resolved against the firm default at send time when still 'default').
ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS email_sender_mode       text NOT NULL DEFAULT 'default'
    CHECK (email_sender_mode IN ('default','owner','specific')),
  ADD COLUMN IF NOT EXISTS email_sender_mailbox_id uuid REFERENCES public.firm_sending_mailboxes(id) ON DELETE SET NULL;
