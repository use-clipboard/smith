-- ─── HR: per-user first-year holiday pro-rata flag ───────────────────────
-- A team member's holiday entitlement (default firm value OR explicit
-- override) historically applied as-is from day one. Real life is messier:
-- mid-year joiners typically only earn a slice of that for their first
-- holiday year, then full entitlement once the year resets.
--
-- This flag opts a user into "for your FIRST holiday year only, pro-rata
-- from your employment start date". The balance API honours it; once the
-- year rolls over the flag becomes a no-op without any admin intervention
-- because the start date no longer falls inside the current window.

alter table public.users
  add column if not exists pro_rata_first_year boolean not null default false;

comment on column public.users.pro_rata_first_year is
  'When true and employment_start_date falls inside the current firm holiday year, the balance API pro-rates the user''s full annual entitlement from their start date. After the year rolls over this naturally becomes a no-op.';
