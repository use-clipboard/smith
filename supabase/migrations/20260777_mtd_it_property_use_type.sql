-- MTD IT — property use type (residential vs commercial).
--
-- The residential finance-cost restriction (ITTOIA s.272A) applies to
-- RESIDENTIAL lets only; commercial-property interest stays fully deductible.
-- The actual treatment is driven by the entry's category (Residential vs
-- Non-Residential Finance Costs), but recording each property's use type lets
-- us (a) show an at-a-glance marker in the allocation dropdown / row chip, and
-- (b) warn when a finance-cost row's category disagrees with the property it's
-- tagged to.
--
-- Optional (nullable = not set / no marker). Client-level, so it persists across
-- every future quarter and tax year automatically. Note: former Furnished
-- Holiday Lets are ordinary RESIDENTIAL property from 6 April 2025 (FHL regime
-- abolished), so there is deliberately no separate FHL/holiday-let value.

alter table public.mtd_it_properties
  add column if not exists use_type text
    check (use_type in ('residential', 'commercial'));
