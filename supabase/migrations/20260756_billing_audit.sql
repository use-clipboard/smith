-- Billing module — audit trail + permissions groundwork.
--
-- Append-only log of invoice lifecycle events (created, sent, paid, cancelled,
-- written off, credited, emailed, deleted, posted to bookkeeping). invoice_id is
-- a plain uuid (no FK) so an event survives its invoice being deleted. Read by
-- the whole firm; insert-only (no update/delete policy) so it can't be rewritten.

create table if not exists public.billing_audit (
  id         uuid primary key default gen_random_uuid(),
  firm_id    uuid not null references public.firms(id) on delete cascade,
  invoice_id uuid,
  user_id    uuid references public.users(id) on delete set null,
  action     text not null,
  detail     text,
  created_at timestamptz not null default now()
);

create index if not exists billing_audit_firm_idx    on public.billing_audit (firm_id, created_at desc);
create index if not exists billing_audit_invoice_idx on public.billing_audit (invoice_id, created_at desc);

alter table public.billing_audit enable row level security;

drop policy if exists billing_audit_firm_read on public.billing_audit;
create policy billing_audit_firm_read on public.billing_audit
  for select using (firm_id = (select u.firm_id from public.users u where u.id = auth.uid()));

drop policy if exists billing_audit_firm_insert on public.billing_audit;
create policy billing_audit_firm_insert on public.billing_audit
  for insert with check (firm_id = (select u.firm_id from public.users u where u.id = auth.uid()));
