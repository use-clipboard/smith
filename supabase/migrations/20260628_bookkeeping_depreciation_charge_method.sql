-- ── Persist the method & rate actually used on each posted depreciation charge ─
--
-- Previously the schedule re-derived the method/rate for a posted period from
-- the *current* effective-dated settings (settingInForce at the period start).
-- Because a user can add a setting with a back-dated effective_from, the
-- displayed method/rate for an already-posted period could drift away from what
-- was genuinely charged (the stored amount never changes, so the figures stop
-- agreeing). Storing the method & rate on the charge row at post time pins the
-- display to the truth.
--
-- Nullable so legacy rows (posted before this migration) keep working — the
-- engine falls back to settingInForce when these are null.

alter table public.bookkeeping_depreciation_charges
  add column if not exists method text
    check (method is null or method in ('straight_line', 'reducing_balance')),
  add column if not exists annual_rate numeric(6,3)
    check (annual_rate is null or (annual_rate >= 0 and annual_rate <= 100));

comment on column public.bookkeeping_depreciation_charges.method is
  'The depreciation method in force when this charge was posted. Pins the schedule display to what was actually charged, independent of later (possibly back-dated) settings changes. NULL for charges posted before this column existed.';
comment on column public.bookkeeping_depreciation_charges.annual_rate is
  'The annual rate (%) in force when this charge was posted. See method column. NULL for legacy rows.';
