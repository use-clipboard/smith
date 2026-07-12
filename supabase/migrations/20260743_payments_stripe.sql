-- Billing module — Phase D: payments (Stripe card + Bacs Direct Debit) + CSV reconciliation.
--
-- Stripe is called via its REST API (no SDK dependency). Platform keys live in
-- env (STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET / NEXT_PUBLIC_STRIPE_*). These
-- columns store the Stripe object ids we need to collect against a mandate and
-- to reconcile webhook events back to firm data.

-- Bacs Direct Debit mandates (Stripe-backed). One row per client mandate.
create table if not exists public.dd_mandates (
  id                  uuid primary key default gen_random_uuid(),
  firm_id             uuid not null references public.firms(id) on delete cascade,
  client_id           uuid references public.clients(id) on delete set null,
  provider            text not null default 'stripe',
  provider_mandate_id text,
  status              text not null default 'pending'
                        check (status in ('pending','active','failed','cancelled')),
  bank_last4          text,
  created_at          timestamptz not null default now(),
  activated_at        timestamptz
);
create index if not exists dd_mandates_firm_idx   on public.dd_mandates (firm_id, status);
create index if not exists dd_mandates_client_idx on public.dd_mandates (client_id);

alter table public.dd_mandates enable row level security;
drop policy if exists dd_mandates_firm_all on public.dd_mandates;
create policy dd_mandates_firm_all on public.dd_mandates
  for all using (
    firm_id = (select u.firm_id from public.users u where u.id = auth.uid())
  ) with check (
    firm_id = (select u.firm_id from public.users u where u.id = auth.uid())
  );

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
