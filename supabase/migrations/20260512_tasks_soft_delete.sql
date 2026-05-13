-- ─── Soft-delete for tasks + audit columns ───────────────────────────────────
-- Tasks are now soft-deleted: rows remain in the table with `deleted_at` set,
-- preserving the full history (steps, time entries, comments) for audit
-- and reporting purposes. The History view in the Tasks tool reads these rows.

ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS deleted_at  timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_by  uuid REFERENCES public.users(id) ON DELETE SET NULL;

-- Index to make history queries (and the "active tasks" filter) fast
CREATE INDEX IF NOT EXISTS idx_tasks_deleted_at ON public.tasks(deleted_at);
CREATE INDEX IF NOT EXISTS idx_tasks_completed_at ON public.tasks(completed_at);
