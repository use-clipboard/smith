-- ============================================================
--  HR — Firm-wide read of approved holidays for the calendar view
-- ============================================================
--  The original policy only let you see your own holidays + ones
--  you manage. That hides bank holidays (manager_id is null) and
--  colleagues' holidays from the shared calendar.
--
--  Add an additional SELECT policy so anyone in the firm can read
--  *approved* holidays in their firm. Pending/rejected/cancelled
--  entries remain private to requester/manager/admin via the
--  existing policy.
-- ============================================================

create policy "hr_holidays: read approved in firm"
  on public.hr_holiday_requests for select
  using (
    firm_id = public.my_firm_id() and status = 'approved'
  );
