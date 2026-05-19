-- Tasks → Outputs back-reference
--
-- When a task is spawned from an AI output (e.g. "Create task" on the
-- Meeting Notes history row or review screen), we record the source
-- outputs.id on the task. The history view uses this to:
--   - show a "task already exists" marker on rows with a linked task
--   - hide / disable the "Create task" action when one is already in play
--
-- ON DELETE SET NULL so deleting the output doesn't cascade-delete the
-- task — the task is the user's work product and survives the output.

alter table public.tasks
  add column if not exists source_output_id uuid references public.outputs(id) on delete set null;

create index if not exists tasks_source_output_idx on public.tasks (source_output_id);

comment on column public.tasks.source_output_id is
  'The AI output (e.g. meeting notes save) this task was spawned from. Used to surface a "task created" marker next to the source row in history.';
