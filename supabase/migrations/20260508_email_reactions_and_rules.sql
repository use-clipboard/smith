-- Email reactions: team members can react to individual messages with emoji
CREATE TABLE IF NOT EXISTS email_reactions (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id     uuid        NOT NULL REFERENCES firms(id)  ON DELETE CASCADE,
  user_id     uuid        NOT NULL REFERENCES users(id)  ON DELETE CASCADE,
  thread_id   text        NOT NULL,
  message_id  text        NOT NULL,
  emoji       text        NOT NULL,
  created_at  timestamptz DEFAULT now(),
  CONSTRAINT  email_reactions_unique UNIQUE (user_id, message_id, emoji)
);
CREATE INDEX IF NOT EXISTS idx_email_reactions_thread ON email_reactions(firm_id, thread_id);

ALTER TABLE email_reactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY email_reactions_select ON email_reactions FOR SELECT
  USING (firm_id = (SELECT firm_id FROM users WHERE id = auth.uid()));
CREATE POLICY email_reactions_insert ON email_reactions FOR INSERT
  WITH CHECK (user_id = auth.uid() AND firm_id = (SELECT firm_id FROM users WHERE id = auth.uid()));
CREATE POLICY email_reactions_delete ON email_reactions FOR DELETE
  USING (user_id = auth.uid());

-- Email rules: auto-apply actions to incoming threads matching a condition
CREATE TABLE IF NOT EXISTS email_rules (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id            uuid        NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
  created_by         uuid        REFERENCES users(id) ON DELETE SET NULL,
  name               text        NOT NULL DEFAULT '',
  is_active          boolean     NOT NULL DEFAULT true,
  -- Condition
  condition_field    text        NOT NULL CHECK (condition_field IN ('from','to','subject','has_words')),
  condition_operator text        NOT NULL CHECK (condition_operator IN ('contains','equals','starts_with','ends_with')),
  condition_value    text        NOT NULL,
  -- Action
  action_type        text        NOT NULL CHECK (action_type IN ('archive','label','mark_read','star','trash')),
  action_label_id    text,        -- Gmail label ID, only for 'label' action
  action_label_name  text,        -- human-readable name for the label
  created_at         timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_email_rules_firm ON email_rules(firm_id, is_active);

ALTER TABLE email_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY email_rules_select ON email_rules FOR SELECT
  USING (firm_id = (SELECT firm_id FROM users WHERE id = auth.uid()));
CREATE POLICY email_rules_insert ON email_rules FOR INSERT
  WITH CHECK (firm_id = (SELECT firm_id FROM users WHERE id = auth.uid()));
CREATE POLICY email_rules_update ON email_rules FOR UPDATE
  USING (firm_id = (SELECT firm_id FROM users WHERE id = auth.uid()));
CREATE POLICY email_rules_delete ON email_rules FOR DELETE
  USING (firm_id = (SELECT firm_id FROM users WHERE id = auth.uid()));
