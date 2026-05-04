-- ─── Client Portal: Magic Link Tokens ────────────────────────────────────────
-- Run this migration to enable the client-facing task portal feature.

-- 1. Add client-portal fields to task_template_steps
ALTER TABLE task_template_steps
  ADD COLUMN IF NOT EXISTS client_instructions text,
  ADD COLUMN IF NOT EXISTS client_can_upload boolean NOT NULL DEFAULT false;

-- 2. Add client-portal fields to task_steps
ALTER TABLE task_steps
  ADD COLUMN IF NOT EXISTS client_instructions text,
  ADD COLUMN IF NOT EXISTS client_can_upload boolean NOT NULL DEFAULT false;

-- 3. Client access tokens table
CREATE TABLE IF NOT EXISTS task_client_tokens (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  token       text        UNIQUE NOT NULL DEFAULT encode(gen_random_bytes(32), 'hex'),
  task_id     uuid        NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  step_id     uuid        NOT NULL REFERENCES task_steps(id) ON DELETE CASCADE,
  firm_id     uuid        NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
  expires_at  timestamptz NOT NULL DEFAULT now() + interval '30 days',
  completed_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS task_client_tokens_token_idx   ON task_client_tokens(token);
CREATE INDEX IF NOT EXISTS task_client_tokens_step_id_idx ON task_client_tokens(step_id);
CREATE INDEX IF NOT EXISTS task_client_tokens_task_id_idx ON task_client_tokens(task_id);

-- 4. RLS on task_client_tokens — no direct client access needed (API route handles auth)
ALTER TABLE task_client_tokens ENABLE ROW LEVEL SECURITY;

-- Firm staff can read/manage their own firm's tokens
CREATE POLICY "firm_staff_manage_tokens"
  ON task_client_tokens FOR ALL
  USING (
    firm_id IN (
      SELECT firm_id FROM users WHERE id = auth.uid()
    )
  );

-- 5. Client uploaded files bucket — create if it doesn't already exist
-- (Run in Supabase dashboard Storage section if this migration tooling doesn't support storage)
-- INSERT INTO storage.buckets (id, name, public) VALUES ('client-uploads', 'client-uploads', false)
-- ON CONFLICT DO NOTHING;
