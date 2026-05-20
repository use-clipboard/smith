-- VAT scheme period-end month for clients.
-- Stores the month (1–12) that completes the client's VAT period, used in
-- combination with the existing vat_scheme column:
--   • Yearly   → 1–12 = the month their annual VAT period ends
--   • Quarterly → exactly one of {1, 2, 3}, mapping to HMRC stagger groups:
--       1 = Apr/Jul/Oct/Jan
--       2 = May/Aug/Nov/Feb
--       3 = Mar/Jun/Sep/Dec
--   • Monthly  → NULL (no period-end concept)
--
-- The CHECK only enforces the 1–12 range; the scheme-specific narrowing
-- (only 1–3 for Quarterly) is enforced in the API layer so it can be
-- relaxed in future without a migration.

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS vat_scheme_period_end_month smallint
    CHECK (vat_scheme_period_end_month IS NULL OR vat_scheme_period_end_month BETWEEN 1 AND 12);
