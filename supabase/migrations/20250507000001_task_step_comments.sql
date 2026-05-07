-- Task step comments: visible to all firm members
CREATE TABLE IF NOT EXISTS task_step_comments (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id     uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  step_id     uuid NOT NULL,
  user_id     uuid REFERENCES users(id) ON DELETE SET NULL,
  content     text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS task_step_comments_step_id_idx ON task_step_comments(step_id);
CREATE INDEX IF NOT EXISTS task_step_comments_task_id_idx ON task_step_comments(task_id);

ALTER TABLE task_step_comments ENABLE ROW LEVEL SECURITY;

-- Users can read comments belonging to their firm's tasks
CREATE POLICY "firm members can read step comments"
  ON task_step_comments FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM tasks t
      JOIN users u ON u.firm_id = (
        SELECT firm_id FROM users WHERE id = auth.uid()
      )
      WHERE t.id = task_step_comments.task_id
    )
  );

-- Users can insert comments on their firm's tasks
CREATE POLICY "firm members can insert step comments"
  ON task_step_comments FOR INSERT
  WITH CHECK (
    user_id = auth.uid() AND
    EXISTS (
      SELECT 1 FROM tasks t
      JOIN users u ON u.id = auth.uid() AND u.firm_id IS NOT NULL
      WHERE t.id = task_step_comments.task_id
    )
  );
