-- Billing module — Phase B: recurring invoices + proposal-driven billing.
--
-- A recurring_invoices row is a billing schedule: a line template plus a
-- frequency and next_run_date. A daily cron (/api/billing/recurring/run) mints
-- an `invoices` row each time next_run_date arrives, then advances the date.
-- Minted invoices carry source='recurring' and source_id=recurring_invoices.id
-- (idempotency key = source_id + issue_date). Firm-scoped, like the rest of
-- the billing tables.

create table if not exists public.recurring_invoices (
  id             uuid primary key default gen_random_uuid(),
  firm_id        uuid not null references public.firms(id) on delete cascade,
  client_id      uuid references public.clients(id) on delete set null,
  client_name    text,
  frequency      text not null default 'monthly'
                   check (frequency in ('monthly','quarterly','annual','custom')),
  interval_days  integer,                       -- for frequency='custom'
  day_of_month   integer,                       -- optional anchor (1–28)
  start_date     date not null,
  next_run_date  date not null,
  end_date       date,                          -- optional stop
  status         text not null default 'active'
                   check (status in ('active','paused')),
  -- Line template: [{ description, quantity, unit_price_pence, vat_rate }]
  template       jsonb not null default '[]'::jsonb,
  subtotal_pence integer not null default 0,
  vat_pence      integer not null default 0,
  total_pence    integer not null default 0,
  notes          text,
  terms          text,
  -- When true, minted invoices are issued (numbered + status 'sent'); else left as drafts.
  auto_send      boolean not null default false,
  -- Provenance (drift detection back to the proposal that spawned this).
  proposal_id    uuid references public.proposals(id) on delete set null,
  source_note    text,
  last_invoice_id uuid references public.invoices(id) on delete set null,
  last_run_date  date,
  created_by     uuid references public.users(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists recurring_invoices_firm_idx  on public.recurring_invoices (firm_id, status);
create index if not exists recurring_invoices_due_idx    on public.recurring_invoices (status, next_run_date);
create index if not exists recurring_invoices_client_idx on public.recurring_invoices (client_id);

comment on table public.recurring_invoices is
  'Billing module — recurring invoice schedules. Cron mints invoices on next_run_date.';

alter table public.recurring_invoices enable row level security;

drop policy if exists recurring_invoices_firm_all on public.recurring_invoices;
create policy recurring_invoices_firm_all on public.recurring_invoices
  for all using (
    firm_id = (select u.firm_id from public.users u where u.id = auth.uid())
  ) with check (
    firm_id = (select u.firm_id from public.users u where u.id = auth.uid())
  );

-- Proposal-acceptance automation: opt-in flag to auto-create billing schedules
-- from an accepted proposal's line items (side-effect 6 in the onboarding route).
alter table public.firm_proposal_settings
  add column if not exists auto_create_billing boolean not null default false;
