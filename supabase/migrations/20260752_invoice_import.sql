-- Billing module — invoice import / migration from other systems.
--
-- An import batch groups everything one upload created, so the whole thing can
-- be undone in a click. Imported invoices + recurring schedules carry the batch
-- id. `source='import'` distinguishes migrated invoices from ones raised in SMITH.

create table if not exists public.invoice_import_batches (
  id                    uuid primary key default gen_random_uuid(),
  firm_id               uuid not null references public.firms(id) on delete cascade,
  source                text,                 -- 'xero' | 'quickbooks' | 'sage' | 'vt' | 'generic' | 'ai'
  filename              text,
  invoice_count         integer not null default 0,
  client_created_count  integer not null default 0,
  recurring_count       integer not null default 0,
  created_by            uuid references public.users(id) on delete set null,
  created_at            timestamptz not null default now()
);

create index if not exists invoice_import_batches_firm_idx on public.invoice_import_batches (firm_id, created_at desc);

alter table public.invoice_import_batches enable row level security;
drop policy if exists invoice_import_batches_firm_all on public.invoice_import_batches;
create policy invoice_import_batches_firm_all on public.invoice_import_batches
  for all using (firm_id = (select u.firm_id from public.users u where u.id = auth.uid()))
  with check (firm_id = (select u.firm_id from public.users u where u.id = auth.uid()));

-- Tag imported invoices with their batch + allow source='import'.
alter table public.invoices add column if not exists import_batch uuid references public.invoice_import_batches(id) on delete set null;
create index if not exists invoices_import_batch_idx on public.invoices (import_batch);

alter table public.invoices drop constraint if exists invoices_source_check;
alter table public.invoices add constraint invoices_source_check
  check (source in ('manual','recurring','proposal','timesheet','advisory','import'));

-- Tag imported recurring schedules too.
alter table public.recurring_invoices add column if not exists import_batch uuid references public.invoice_import_batches(id) on delete set null;
create index if not exists recurring_invoices_import_batch_idx on public.recurring_invoices (import_batch);
