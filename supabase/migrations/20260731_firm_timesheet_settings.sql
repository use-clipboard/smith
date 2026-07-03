-- Firm-level Timesheets configuration.
--
-- Holds the firm's editable departments + work activities as JSON, set in
-- Settings → Timesheets. Null = the app's built-in defaults.
--
-- Shape: { "departments": ["Accounts", ...],
--          "activities": [{ "id","label","type","department" }, ...] }

alter table public.firms
  add column if not exists timesheet_settings jsonb;

comment on column public.firms.timesheet_settings is
  'Firm Timesheets config — departments + work activities (see Settings → Timesheets).';
