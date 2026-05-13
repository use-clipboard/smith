-- ─── Backfill task_steps.template_step_id ─────────────────────────────────
-- The column has existed since 20260430_tasks_schema.sql but was never
-- populated by the various step-insert code paths. Without it set, every
-- task step shows as "Custom" in the UI. This backfill walks every task
-- linked to a template and, for any task_step whose template_step_id is
-- null, finds the template step with the same step_key and links them.
-- Idempotent — re-running is safe (only touches rows with NULL).

UPDATE public.task_steps ts
SET    template_step_id = tts.id
FROM   public.tasks t
JOIN   public.task_template_steps tts ON tts.template_id = t.template_id
WHERE  ts.task_id = t.id
  AND  ts.template_step_id IS NULL
  AND  ts.step_key = tts.step_key
  AND  t.template_id IS NOT NULL;
