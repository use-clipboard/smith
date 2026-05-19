-- Track which user marked a task as complete.
--
-- `completed_at` already exists; this adds the matching `completed_by`
-- so the History view can show "Completed by X on Y" the same way it
-- already shows "Created by X". Existing completed tasks keep
-- completed_by = NULL because the historical actor isn't recoverable
-- without an audit-table backfill.

alter table public.tasks
  add column if not exists completed_by uuid references public.users(id) on delete set null;

comment on column public.tasks.completed_by is
  'User who marked the task complete. NULL for tasks completed before this column existed.';

create index if not exists tasks_completed_by_idx on public.tasks (completed_by) where completed_by is not null;
