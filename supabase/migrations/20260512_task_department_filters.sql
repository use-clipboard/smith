-- ─── Per-department locked date-range filters ────────────────────────────────
-- Stores firm-wide locked due-date ranges per template category (department).
-- When `locked = true`, the date range applies to every user in the firm and
-- only an admin may unlock it. This powers the Departments view in the Tasks
-- tool, used by department managers to review team progress.

CREATE TABLE IF NOT EXISTS public.task_department_filters (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id     uuid        NOT NULL REFERENCES public.firms(id) ON DELETE CASCADE,
  category    text        NOT NULL,
  date_from   date,
  date_to     date,
  locked      boolean     NOT NULL DEFAULT false,
  locked_by   uuid        REFERENCES public.users(id) ON DELETE SET NULL,
  locked_at   timestamptz,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (firm_id, category)
);

CREATE INDEX IF NOT EXISTS idx_task_department_filters_firm
  ON public.task_department_filters(firm_id);

ALTER TABLE public.task_department_filters ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "firm_access_task_department_filters"
  ON public.task_department_filters;

CREATE POLICY "firm_access_task_department_filters"
  ON public.task_department_filters FOR ALL
  USING (firm_id IN (SELECT firm_id FROM public.users WHERE id = auth.uid()));
