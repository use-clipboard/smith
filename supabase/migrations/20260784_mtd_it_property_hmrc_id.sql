-- MTD IT — HMRC per-property id for foreign property (TY 2026-27+).
--
-- From tax year 2026-27, HMRC keys the foreign-property cumulative period
-- summary by `propertyId` (a per-property UUID assigned by HMRC) instead of by
-- countryCode. Each SMITH foreign property therefore needs to be linked to an
-- HMRC foreign-property id, obtained from the Property Business API foreign
-- "details" endpoints (GET lists existing properties + their ids; POST creates
-- one and returns its id). We resolve/create these lazily at submit time and
-- cache the id here so we don't re-create on every filing.
--
-- Nullable: only foreign properties use it, and only for 2026-27+ filings.

alter table public.mtd_it_properties
  add column if not exists hmrc_property_id text;

comment on column public.mtd_it_properties.hmrc_property_id is
  'HMRC foreign-property id (Property Business API), used to key the foreign cumulative body from TY 2026-27. Resolved/created lazily at submit time.';
