-- Allow users to edit their own step comments
CREATE POLICY "users can update own step comments"
  ON task_step_comments FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Allow users to delete their own step comments
CREATE POLICY "users can delete own step comments"
  ON task_step_comments FOR DELETE
  USING (user_id = auth.uid());
