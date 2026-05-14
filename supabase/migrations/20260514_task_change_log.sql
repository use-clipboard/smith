-- Audit log of task edits (recurring or not).
-- One row per atomic change: a multi-field update writes one row per changed field.
-- Powers the "Recurring Changes" view in the Tasks tool.
create table if not exists task_change_log (
  id                    uuid primary key default gen_random_uuid(),
  task_id               uuid not null references tasks(id) on delete cascade,
  firm_id               uuid not null references firms(id) on delete cascade,
  client_id             uuid references clients(id) on delete set null,
  changed_by            uuid references users(id) on delete set null,
  -- Coarse classification of the change
  change_type           text not null check (
    change_type in ('created','updated','completed','reopened','deleted')
  ),
  -- For 'updated' rows: which field changed. Null for create/delete/completed/reopened.
  field_name            text,
  old_value             text,
  new_value             text,
  -- Snapshot so the change log stays meaningful even if the task is later
  -- renamed or hard-deleted.
  task_title_at_change  text,
  changed_at            timestamptz not null default now()
);

create index if not exists task_change_log_firm_time_idx
  on task_change_log(firm_id, changed_at desc);
create index if not exists task_change_log_task_idx
  on task_change_log(task_id, changed_at desc);

alter table task_change_log enable row level security;

-- Firm members can read their firm's change history
create policy "Firm members read own firm task changes"
  on task_change_log for select
  using (firm_id in (select firm_id from users where id = auth.uid()));

-- Inserts only via server-side service role — no insert policy needed.
