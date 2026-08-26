-- Per-user preference: which task-change notifications the user wants.
--   'all'    → notify me about any task change (default; current behaviour)
--   'oneoff' → only for one-off tasks (never recurring/template/spawned tasks)
--   'none'   → no task-change notifications at all
-- Set by each user for themselves (not firm-wide).
alter table public.users
  add column if not exists notify_task_changes text not null default 'all'
    check (notify_task_changes in ('all', 'oneoff', 'none'));
