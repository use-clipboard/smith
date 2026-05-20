-- Add 'four-weekly' (28-day) recurrence — needed for payroll clients.
-- The existing CHECK constraint on tasks.recurrence_type was created
-- inline (no explicit name) in 20260430_tasks_schema.sql, so we have to
-- discover its name at runtime and drop it before adding the new one.

DO $$
DECLARE
  v_constraint_name text;
BEGIN
  SELECT conname INTO v_constraint_name
  FROM pg_constraint
  WHERE conrelid = 'public.tasks'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) LIKE '%recurrence_type%';

  IF v_constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.tasks DROP CONSTRAINT %I', v_constraint_name);
  END IF;
END $$;

ALTER TABLE public.tasks
  ADD CONSTRAINT tasks_recurrence_type_check
  CHECK (recurrence_type IN ('once','weekly','bi-weekly','four-weekly','monthly','quarterly','annually','custom'));
