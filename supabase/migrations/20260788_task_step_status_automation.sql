-- Per-step status automation for full tasks.
--
-- A step can carry a rule: when it reaches a given status (`on`), set the whole
-- task's status to `set_task_status`. Enforced server-side in the step-update
-- route (see app/api/tasks/[id]/steps/[stepId]/route.ts). Shape:
--   { "on": "complete", "set_task_status": "records_here" }
-- NULL / absent = no automation (the default; behaviour unchanged).

alter table task_steps
  add column if not exists status_automation jsonb;

comment on column task_steps.status_automation is
  'Optional {on: step-status, set_task_status: task-status} rule that changes the task status when this step reaches `on`. Null = none.';

-- Same rule on template steps, so a workflow saved as a template keeps its
-- automations when re-applied (directly or via bulk-create).
alter table task_template_steps
  add column if not exists status_automation jsonb;

comment on column task_template_steps.status_automation is
  'Optional {on, set_task_status} rule copied onto task_steps.status_automation when the template is applied.';
