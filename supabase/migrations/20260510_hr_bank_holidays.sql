-- ============================================================
--  HR module — Bank holidays
-- ============================================================
--  Toggle on firm_hr_settings to auto-create UK bank holidays as
--  approved firm-wide holiday entries. Region-aware (England &
--  Wales / Scotland / Northern Ireland) since the gov.uk feed
--  splits them.
--  Sync writes one hr_holiday_requests row per user × per bank
--  holiday, status='approved', source='direct'. Idempotent — uses
--  a uniqueness check on (firm_id, user_id, start_date, source) to
--  avoid duplicates if synced twice.
-- ============================================================

alter table public.firm_hr_settings
  add column if not exists bank_holidays_enabled boolean not null default false,
  add column if not exists bank_holidays_region text not null default 'england-and-wales'
    check (bank_holidays_region in ('england-and-wales', 'scotland', 'northern-ireland')),
  add column if not exists bank_holidays_last_synced_at timestamptz;

-- Add a tag column to hr_holiday_requests so bank-holiday rows can be
-- distinguished from manager-recorded rows (both are source='direct').
-- We only use this as a hint; existing rows are unaffected.
alter table public.hr_holiday_requests
  add column if not exists is_bank_holiday boolean not null default false,
  add column if not exists bank_holiday_title text;

-- Soft uniqueness — prevents the sync from inserting duplicates if
-- accidentally run twice for the same date / user / firm. (Not a hard
-- unique index because a user can also legitimately have a separate
-- holiday request on the same day before bank holidays were synced —
-- duplicate detection is done in the sync code, not enforced by SQL.)
create index if not exists hr_holidays_bank_idx
  on public.hr_holiday_requests (firm_id, user_id, start_date)
  where is_bank_holiday = true;
