-- Timesheets — per-client weekly time budgets.
--
-- One weekly budget (in minutes) per client, used by the Budget-vs-Actual
-- report. The report scales the weekly figure by the number of weeks in the
-- selected period. Any firm member may set budgets (all staff can work any
-- client). Falls back to a sensible default in the app when unset.

create table if not exists public.timesheet_client_budgets (
  id                     uuid primary key default gen_random_uuid(),
  firm_id                uuid not null references public.firms(id) on delete cascade,
  client_id              uuid not null references public.clients(id) on delete cascade,
  weekly_budget_minutes  integer not null default 0 check (weekly_budget_minutes >= 0),
  updated_by             uuid references public.users(id) on delete set null,
  updated_at             timestamptz not null default now(),
  unique (firm_id, client_id)
);

create index if not exists timesheet_client_budgets_firm_idx
  on public.timesheet_client_budgets (firm_id);

comment on table public.timesheet_client_budgets is
  'Per-client weekly time budget (minutes) for the Timesheets Budget-vs-Actual report.';

alter table public.timesheet_client_budgets enable row level security;

drop policy if exists tcb_firm_all on public.timesheet_client_budgets;
create policy tcb_firm_all on public.timesheet_client_budgets
  for all using (
    firm_id = (select u.firm_id from public.users u where u.id = auth.uid())
  ) with check (
    firm_id = (select u.firm_id from public.users u where u.id = auth.uid())
  );
