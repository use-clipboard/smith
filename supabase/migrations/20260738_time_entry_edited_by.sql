-- Attribution for approver ("manager/admin") edits of a team member's time.
-- A timesheet is the employee's own assertion, so any edit by someone else is
-- recorded here (who + when) and surfaced in the UI + a notification. Edits by
-- the owner leave these null.

alter table time_entries
  add column if not exists edited_by uuid references users(id),
  add column if not exists edited_at timestamptz;
