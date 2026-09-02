-- "From your plan" timesheet suggestions: when a user ticks a task done in the
-- Organise-my-day planner, the block's allotted time becomes a suggested time
-- entry (linked to the task) awaiting confirmation in Timesheets' AI-suggested
-- panel. One pending row per user + task + day.

create table if not exists timesheet_plan_suggestions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references users(id) on delete cascade,
  firm_id     uuid not null references firms(id) on delete cascade,
  task_id     uuid references tasks(id) on delete cascade,
  client_id   uuid references clients(id) on delete set null,
  title       text not null,
  is_internal boolean not null default false,
  minutes     int not null,
  work_date   date not null,
  created_at  timestamptz not null default now(),
  unique (user_id, task_id, work_date)
);

alter table timesheet_plan_suggestions enable row level security;

drop policy if exists tps_own on timesheet_plan_suggestions;
create policy tps_own on timesheet_plan_suggestions
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
