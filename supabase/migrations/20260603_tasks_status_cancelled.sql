-- Re-add 'cancelled' to the tasks status check constraint.
--
-- The original schema (20260430) allowed 'cancelled' but it was dropped
-- by the 20260507_records_here_status migration that rebuilt the
-- constraint and forgot to carry it through. The rest of the codebase
-- already filters on it (e.g. /api/outputs joins exclude
-- status IN ('complete','cancelled')), and the new client-status policy
-- relies on it to mark tasks as auto-cancelled when their client is
-- moved to Inactive.

ALTER TABLE public.tasks
  DROP CONSTRAINT IF EXISTS tasks_status_check;

ALTER TABLE public.tasks
  ADD CONSTRAINT tasks_status_check
    CHECK (status IN (
      'not_started',
      'in_progress',
      'waiting_on_client',
      'records_here',
      'review',
      'complete',
      'draft',
      'cancelled'
    ));
