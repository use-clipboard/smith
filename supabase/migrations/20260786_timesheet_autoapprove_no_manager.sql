-- Timesheets — align existing data with the new approval rule.
--
-- New rule: a submitted week is routed only to the submitter's manager; a user
-- with NO manager has their week auto-approved (nobody needs to sign it off).
-- Before this, manager-less weeks sat as 'submitted' and fell back to every
-- admin. This one-off clears that backlog by auto-approving any already-submitted
-- week that has no manager, so it stops appearing in admins' approval queues.
--
-- Idempotent: re-running only affects rows still submitted with no manager.

update public.timesheet_week_status
set status      = 'approved',
    reviewed_by = null,
    reviewed_at = coalesce(reviewed_at, now())
where status = 'submitted'
  and manager_id is null;
