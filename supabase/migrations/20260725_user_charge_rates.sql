-- Timesheets — per-user charge-out rate + weekly capacity.
--
-- Drives utilisation (billable ÷ capacity), chargeable value, recovery and the
-- staff leaderboard. Nullable — the Timesheets module falls back to sensible
-- defaults (£120/h, 37.5h) when a firm hasn't set them yet.

alter table public.users
  add column if not exists charge_out_rate_pence integer,
  add column if not exists weekly_capacity_hours  numeric;

comment on column public.users.charge_out_rate_pence is
  'Standard charge-out rate in pence per hour, used by the Timesheets module.';
comment on column public.users.weekly_capacity_hours is
  'Contracted chargeable hours per week, used for utilisation in Timesheets.';
