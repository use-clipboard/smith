-- Add 'records_here' to the tasks status check constraint
-- This status lets the team flag that client records have arrived and work can begin

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
      'draft'
    ));
