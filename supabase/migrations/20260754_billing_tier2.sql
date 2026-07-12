-- Billing module — Tier 2: invoice themes + logo, default terms, and the
-- Bookkeeping-posting link.
--
-- • invoice_accent / invoice_template — pick a colour + layout for the PDF.
-- • logo_path — firm logo in the private billing-branding bucket (served as a
--   data URL and embedded in the invoice PDF).
-- • default_terms — free text (payment terms / T&Cs) printed on every invoice.
-- • bookkeeping_book_id — which Bookkeeping book issued invoices post a sale
--   into; invoices.bookkeeping_txn_id records the posted transaction (idempotency).

alter table public.billing_settings
  add column if not exists invoice_accent      text not null default '#7C3AED',
  add column if not exists invoice_template     text not null default 'modern',
  add column if not exists logo_path            text,
  add column if not exists default_terms        text not null default '',
  add column if not exists bookkeeping_book_id  uuid;

alter table public.invoices
  add column if not exists bookkeeping_txn_id uuid;

-- Private bucket for firm invoice logos (served via service-role data URL).
insert into storage.buckets (id, name, public)
values ('billing-branding', 'billing-branding', false)
on conflict (id) do nothing;
