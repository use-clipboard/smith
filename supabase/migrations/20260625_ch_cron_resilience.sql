-- CH cron resilience — per-number failure tracking + visible skip list.
--
-- Background: prior to this migration a single poison-pill company (one that
-- always errored — e.g. dissolved + 404, malformed PSC record, etc.) would
-- park itself at the head of remaining_numbers forever. Every subsequent
-- tick would resume, fail on the same number, break, and never reach the
-- companies behind it. The whole firm's refresh would silently stall.
--
-- The cron now tracks per-number consecutive failures and parks a number
-- after a threshold so the rest of the run can proceed. Parked numbers
-- surface to the user via ch_cache.skipped_company_numbers.

ALTER TABLE ch_refresh_jobs
  ADD COLUMN IF NOT EXISTS failures_by_number jsonb  NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS skipped_numbers    text[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN ch_refresh_jobs.failures_by_number IS
  'Per-company consecutive error count during the current run. After N failures the number is moved to skipped_numbers so it stops blocking other companies.';
COMMENT ON COLUMN ch_refresh_jobs.skipped_numbers IS
  'Companies that hit the per-number error threshold during this run. Copied into ch_cache.skipped_company_numbers when the run flushes.';

ALTER TABLE ch_cache
  ADD COLUMN IF NOT EXISTS skipped_company_numbers text[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN ch_cache.skipped_company_numbers IS
  'CH numbers the most recent refresh gave up on after repeated errors. Surfaced to the user so they know which clients need manual review.';
