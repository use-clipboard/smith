-- Add condition columns to task_template_edges and task_step_edges
-- Safe to run multiple times (IF NOT EXISTS).

ALTER TABLE public.task_template_edges
  ADD COLUMN IF NOT EXISTS condition_type   text  CHECK (condition_type IN ('on_complete', 'timeout', 'always')),
  ADD COLUMN IF NOT EXISTS condition_config jsonb;

ALTER TABLE public.task_step_edges
  ADD COLUMN IF NOT EXISTS condition_type   text  CHECK (condition_type IN ('on_complete', 'timeout', 'always')),
  ADD COLUMN IF NOT EXISTS condition_config jsonb;
