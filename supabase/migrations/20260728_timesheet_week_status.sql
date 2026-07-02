-- Timesheets — weekly submission / approval workflow.
--
-- A user submits a week (Monday date) for approval; an admin approves or
-- rejects it. A submitted or approved week is locked for editing in the UI.
-- The absence of a row = 'draft' (freely editable). Writes go through the API
-- with explicit permission checks (self may submit/withdraw; admin may review),
-- so a permissive firm-read policy is all that's needed here.

create table if not exists public.timesheet_week_status (
  id           uuid primary key default gen_random_uuid(),
  firm_id      uuid not null references public.firms(id) on delete cascade,
  user_id      uuid not null references public.users(id) on delete cascade,
  week_start   date not null,
  status       text not null default 'submitted'
                 check (status in ('submitted', 'approved', 'rejected')),
  note         text,
  submitted_at timestamptz not null default now(),
  reviewed_by  uuid references public.users(id) on delete set null,
  reviewed_at  timestamptz,
  unique (user_id, week_start)
);

create index if not exists timesheet_week_status_firm_idx
  on public.timesheet_week_status (firm_id, week_start);

comment on table public.timesheet_week_status is
  'Timesheets weekly submit/approve workflow. No row = draft (editable); submitted/approved = locked.';

alter table public.timesheet_week_status enable row level security;

drop policy if exists tws_firm_read on public.timesheet_week_status;
create policy tws_firm_read on public.timesheet_week_status
  for select using (
    firm_id = (select u.firm_id from public.users u where u.id = auth.uid())
  );
