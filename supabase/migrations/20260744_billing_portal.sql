-- Billing module — Phase E: client statement portal tokens.
--
-- A tokenised, login-free page where a client sees their outstanding invoices +
-- statement and can download PDFs (and pay by card when Stripe is on). One live
-- token per client; the public route resolves it with a service-role client, so
-- RLS here only governs firm-side management.

create table if not exists public.billing_portal_tokens (
  id         uuid primary key default gen_random_uuid(),
  firm_id    uuid not null references public.firms(id) on delete cascade,
  client_id  uuid not null references public.clients(id) on delete cascade,
  token      text not null unique,
  expires_at timestamptz not null default (now() + interval '90 days'),
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists billing_portal_tokens_client_idx on public.billing_portal_tokens (client_id);

alter table public.billing_portal_tokens enable row level security;
drop policy if exists billing_portal_tokens_firm_all on public.billing_portal_tokens;
create policy billing_portal_tokens_firm_all on public.billing_portal_tokens
  for all using (
    firm_id = (select u.firm_id from public.users u where u.id = auth.uid())
  ) with check (
    firm_id = (select u.firm_id from public.users u where u.id = auth.uid())
  );
