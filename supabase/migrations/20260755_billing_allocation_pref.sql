-- Billing module — payment-on-account allocation preference.
--
-- Some systems (e.g. Sage) don't auto-apply a payment on account to the oldest
-- invoice. This lets the firm choose oldest-first or newest-first for the
-- auto-allocate button and the "sweep payments on account" tool.

alter table public.billing_settings
  add column if not exists allocation_preference text not null default 'oldest'
    check (allocation_preference in ('oldest', 'newest'));
