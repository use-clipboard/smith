-- Timesheets — per-user department (service-line team).
--
-- Lets "Time by department" roll up by the team the person belongs to
-- (Accounts, Tax, Audit, Payroll, Advisory, Bookkeeping…) rather than by the
-- activity of each entry. Nullable — falls back to "Unassigned".

alter table public.users
  add column if not exists department text;

comment on column public.users.department is
  'Service-line team the user belongs to, used by the Timesheets department reporting.';
