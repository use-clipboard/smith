-- Billing module — Phase D: payments (Stripe card + Bacs Direct Debit) + CSV reconciliation.
--
-- Stripe is called via its REST API (no SDK dependency). Platform keys live in
-- env (STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET / NEXT_PUBLIC_STRIPE_*). These
-- columns store the Stripe object ids we need to collect against a mandate and
-- to reconcile webhook events back to firm data.

-- Direct-debit mandate ↔ Stripe linkage.
alter table public.dd_mandates
  add column if not exists stripe_customer_id text,
  add column if not exists payment_method_id  text,
  add column if not exists reference           text,
  add column if not exists updated_at          timestamptz not null default now();

-- Payments: record the Stripe fee (if reported) so net cash can be shown later.
alter table public.payments
  add column if not exists stripe_fee_pence integer;

-- A convenience flag so the reconciliation UI can distinguish imported rows.
alter table public.payments
  add column if not exists import_batch text;
