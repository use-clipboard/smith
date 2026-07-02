-- Timesheets — time entries.
--
-- One row per recorded block of time. Firm-wide readable (so the Overview
-- dashboards, team capacity and leaderboard can see everyone), but each user
-- may only write their own rows. client_name is denormalised so a historical
-- entry keeps its label even if the client record is later removed.

create table if not exists public.time_entries (
  id           uuid primary key default gen_random_uuid(),
  firm_id      uuid not null references public.firms(id) on delete cascade,
  user_id      uuid not null references public.users(id) on delete cascade,
  client_id    uuid references public.clients(id) on delete set null,
  client_name  text,
  entry_date   date not null,
  start_time   text,                       -- 'HH:mm' local, optional
  activity     text not null,
  task_title   text,
  department   text,
  entry_type   text not null default 'billable'
                 check (entry_type in ('billable', 'non_billable', 'internal')),
  minutes      integer not null check (minutes > 0),
  rate_pence   integer not null default 0,
  notes        text,
  source       text not null default 'manual'
                 check (source in ('manual', 'timer', 'ai')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists time_entries_firm_date_idx on public.time_entries (firm_id, entry_date);
create index if not exists time_entries_user_idx      on public.time_entries (user_id);

comment on table public.time_entries is
  'Timesheets module — recorded billable/non-billable/internal time. Firm-readable, own-row writable.';

alter table public.time_entries enable row level security;

-- Read: anyone in the firm (team dashboards need the full picture).
drop policy if exists time_entries_firm_read on public.time_entries;
create policy time_entries_firm_read on public.time_entries
  for select using (
    firm_id = (select u.firm_id from public.users u where u.id = auth.uid())
  );

-- Insert: only your own rows, in your own firm.
drop policy if exists time_entries_own_insert on public.time_entries;
create policy time_entries_own_insert on public.time_entries
  for insert with check (
    user_id = auth.uid()
    and firm_id = (select u.firm_id from public.users u where u.id = auth.uid())
  );

-- Update / delete: only your own rows.
drop policy if exists time_entries_own_update on public.time_entries;
create policy time_entries_own_update on public.time_entries
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists time_entries_own_delete on public.time_entries;
create policy time_entries_own_delete on public.time_entries
  for delete using (user_id = auth.uid());
