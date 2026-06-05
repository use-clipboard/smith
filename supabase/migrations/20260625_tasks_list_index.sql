-- ============================================================
--  Speed up the Tasks list query
-- ============================================================
--  GET /api/tasks runs:
--    WHERE firm_id = $1 AND deleted_at IS NULL ORDER BY created_at DESC
--  The existing single-column idx_tasks_firm gets us the firm filter but
--  leaves Postgres to sort the matched rows. This composite partial index
--  serves the filter AND the ordering directly (and excludes soft-deleted
--  rows), so the list comes back pre-sorted.
-- ============================================================

create index if not exists idx_tasks_firm_created_active
  on public.tasks (firm_id, created_at desc)
  where deleted_at is null;
