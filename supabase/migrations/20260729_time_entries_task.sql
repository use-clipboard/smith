-- Timesheets — link time entries to a task.
--
-- Lets a Timesheets entry (or the floating timer) be attributed to a specific
-- task from the Tasks tool, so "time by task" reporting works and a task can
-- show how much time has been logged against it in Timesheets. task_title is
-- denormalised so the label survives if the task is later removed.

alter table public.time_entries
  add column if not exists task_id    uuid references public.tasks(id) on delete set null,
  add column if not exists task_title text;

create index if not exists time_entries_task_idx on public.time_entries (task_id);
