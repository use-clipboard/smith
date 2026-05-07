-- Add step_type, start_trigger_config, and end_config to support
-- special Start and End nodes in the template / task flowchart.
--
-- step_type: 'regular' (default), 'start' (trigger node), 'end' (completion node)
-- start_trigger_config: JSONB config for how the task is triggered (manual, deadline-relative, etc.)
-- end_config: JSONB config for what happens when the workflow reaches the end node

ALTER TABLE public.task_template_steps
  ADD COLUMN IF NOT EXISTS step_type text NOT NULL DEFAULT 'regular'
    CHECK (step_type IN ('regular', 'start', 'end')),
  ADD COLUMN IF NOT EXISTS start_trigger_config jsonb DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS end_config jsonb DEFAULT NULL;

ALTER TABLE public.task_steps
  ADD COLUMN IF NOT EXISTS step_type text NOT NULL DEFAULT 'regular'
    CHECK (step_type IN ('regular', 'start', 'end')),
  ADD COLUMN IF NOT EXISTS start_trigger_config jsonb DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS end_config jsonb DEFAULT NULL;

-- Index for quickly finding start/end nodes in a template
CREATE INDEX IF NOT EXISTS idx_template_steps_type
  ON public.task_template_steps(template_id, step_type)
  WHERE step_type IN ('start', 'end');

CREATE INDEX IF NOT EXISTS idx_task_steps_type
  ON public.task_steps(task_id, step_type)
  WHERE step_type IN ('start', 'end');
