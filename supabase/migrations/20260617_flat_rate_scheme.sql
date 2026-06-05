-- ============================================================
--  Flat Rate Scheme (FRS) VAT support
-- ============================================================
--  • books.flat_rate_percentage — the effective flat rate the user sets
--    (encodes their sector + 1% first-year discount + limited-cost-trader
--    judgement; we deliberately don't auto-derive a tax figure).
--  • transactions.frs_capital_reclaim — marks a purchase as a reclaimable
--    capital asset (>£2,000) whose input VAT IS recoverable into Box 4 even
--    under FRS. Ignored for non-FRS books.
-- ============================================================

alter table public.bookkeeping_books
  add column if not exists flat_rate_percentage numeric(5,2);

alter table public.bookkeeping_transactions
  add column if not exists frs_capital_reclaim boolean not null default false;

comment on column public.bookkeeping_books.flat_rate_percentage is
  'Flat Rate Scheme % (e.g. 14.50). Only meaningful when vat_scheme = flat_rate.';
comment on column public.bookkeeping_transactions.frs_capital_reclaim is
  'FRS: purchase is a reclaimable capital asset (>£2,000) — its input VAT goes into Box 4 despite FRS.';
