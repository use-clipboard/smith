-- Persisted "Organise my day" plans — one per user per day, so a plan set up in
-- the morning survives page refreshes (only "Re-plan" regenerates it). Stores the
-- scheduled block layout as jsonb; task status is overlaid live at render time.

create table if not exists organise_my_day_plans (
  user_id    uuid not null references users(id) on delete cascade,
  plan_date  date not null,
  plan       jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, plan_date)
);

alter table organise_my_day_plans enable row level security;

drop policy if exists omd_plans_own on organise_my_day_plans;
create policy omd_plans_own on organise_my_day_plans
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
