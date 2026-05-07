-- Add 'draft' to the tasks status check constraint
-- Draft tasks are created by Bulk Tasks and require manual activation

ALTER TABLE public.tasks
  DROP CONSTRAINT IF EXISTS tasks_status_check;

ALTER TABLE public.tasks
  ADD CONSTRAINT tasks_status_check
    CHECK (status IN ('not_started','in_progress','complete','on_hold','cancelled','draft'));
