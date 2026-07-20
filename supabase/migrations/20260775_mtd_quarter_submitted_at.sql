-- MTD IT — record WHEN a quarter was submitted.
--
-- `mtd_it_quarters` tracked only `status` and `updated_at`, so anything asking
-- "did this client submit in the last N days?" (Campaigns outcome-linking) had
-- to approximate: status = submitted/approved AND updated_at in range. That
-- misfires if a submitted quarter is edited later for any other reason. A
-- dedicated timestamp makes the answer exact.

alter table public.mtd_it_quarters
  add column if not exists submitted_at timestamptz;

-- Backfill existing submitted quarters from updated_at. This is the same
-- approximation the old logic used, so it's no less accurate than before — but
-- only rows submitted from now on carry a truly precise timestamp.
update public.mtd_it_quarters
   set submitted_at = updated_at
 where submitted_at is null
   and status in ('submitted', 'approved');

-- "Which clients submitted recently?" scans this.
create index if not exists mtd_it_quarters_submitted_at_idx
  on public.mtd_it_quarters (submitted_at)
  where submitted_at is not null;
