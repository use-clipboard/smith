-- Store which specific handles were used when drawing each edge,
-- so the arrow direction matches exactly how the user drew the connection.
-- Safe to run multiple times (IF NOT EXISTS).

ALTER TABLE public.task_template_edges
  ADD COLUMN IF NOT EXISTS source_handle text,
  ADD COLUMN IF NOT EXISTS target_handle text;

ALTER TABLE public.task_step_edges
  ADD COLUMN IF NOT EXISTS source_handle text,
  ADD COLUMN IF NOT EXISTS target_handle text;
