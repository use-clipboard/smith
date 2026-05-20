-- Fix-up to 20260607_tasks_recurrence_four_weekly.sql:
-- That migration extended the CHECK constraint on tasks.recurrence_type,
-- but the task_templates table has its OWN CHECK constraint on the same
-- column, and templates couldn't be saved with the new 'four-weekly' value
-- until that constraint is also updated.

DO $$
DECLARE
  v_constraint_name text;
BEGIN
  SELECT conname INTO v_constraint_name
  FROM pg_constraint
  WHERE conrelid = 'public.task_templates'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) LIKE '%recurrence_type%';

  IF v_constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.task_templates DROP CONSTRAINT %I', v_constraint_name);
  END IF;
END $$;

ALTER TABLE public.task_templates
  ADD CONSTRAINT task_templates_recurrence_type_check
  CHECK (recurrence_type IN ('once','weekly','bi-weekly','four-weekly','monthly','quarterly','annually','custom'));
