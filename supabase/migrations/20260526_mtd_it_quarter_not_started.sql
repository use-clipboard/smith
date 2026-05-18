-- MTD IT — add 'not_started' quarter status
--
-- Previously, opening a quarter page auto-created the row at status='draft',
-- so a curiosity click would falsely tick the dashboard donut as Draft. Now
-- new rows land at 'not_started' and only get promoted to 'draft' when the
-- preparer actually does something meaningful (analyses a file, adds/edits
-- an entry, or explicitly saves as draft).

alter table public.mtd_it_quarters
  drop constraint if exists mtd_it_quarters_status_check;

alter table public.mtd_it_quarters
  add constraint mtd_it_quarters_status_check
  check (status in ('not_started','draft','complete','sent','approved','submitted'));

alter table public.mtd_it_quarters
  alter column status set default 'not_started';
