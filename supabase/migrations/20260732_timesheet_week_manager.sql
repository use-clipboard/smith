-- Timesheets — route week approvals to the submitter's manager.
--
-- Snapshots users.manager_id onto the week-status row at submit time (mirrors
-- the HR holiday-request flow). The submitter's manager OR any admin may then
-- approve/reject. If no manager is set, the week falls back to admins so it can
-- always be actioned.

alter table public.timesheet_week_status
  add column if not exists manager_id uuid references public.users(id) on delete set null;

create index if not exists timesheet_week_status_manager_idx
  on public.timesheet_week_status (manager_id);
