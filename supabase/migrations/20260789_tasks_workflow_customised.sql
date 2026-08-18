-- Flag a task whose workflow has been edited away from its template (via the
-- per-client "edit this client's task only" editor). Drives a "Client-specific"
-- badge in the task lists. Default false; set true when the task's workflow is
-- saved through /api/tasks/[id]/workflow, and carried onto recurrence spawns.

alter table tasks
  add column if not exists workflow_customised boolean not null default false;

comment on column tasks.workflow_customised is
  'True once this task''s workflow was edited independently of its template. Shows a "Client-specific" badge.';
