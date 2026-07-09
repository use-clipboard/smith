-- Billing module — Phase A core ledger.
--
-- The firm charging ITS clients (practice revenue). Distinct from the SMITH
-- subscription ("Subscription" settings tab). All money is stored in integer
-- pence. Every table is firm-scoped: any member of the firm may read and write
-- (billing is a shared practice workspace, like tasks), enforced by RLS.
--
-- Phase A ships: settings, invoices, invoice_lines, payments,
-- payment_allocations, credit_notes. Recurring billing, direct-debit mandates
-- and credit-control tables land in later phases.

-- ─── Firm billing settings (one row per firm) ────────────────────────────────
create table if not exists public.billing_settings (
  firm_id                 uuid primary key references public.firms(id) on delete cascade,
  invoice_prefix          text    not null default 'INV-',
  next_invoice_number     integer not null default 1,
  credit_note_prefix      text    not null default 'CN-',
  next_credit_note_number integer not null default 1,
  default_payment_terms_days integer not null default 14,
  default_vat_rate        numeric not null default 20,
  -- Optional: post issued invoices into the firm's own Bookkeeping sales ledger.
  post_to_bookkeeping     boolean not null default false,
  bookkeeping_sales_account text,
  -- Phase C/D forward config (unused in Phase A).
  reminder_schedule       jsonb,
  auto_chase_default      boolean not null default false,
  payment_provider        text    not null default 'stripe',
  stripe_account_id       text,
  first_invoice_mode      text    not null default 'card_now'
                            check (first_invoice_mode in ('card_now', 'wait_for_dd')),
  created_at              timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

comment on table public.billing_settings is
  'Billing module — per-firm invoicing config (numbering, VAT, bookkeeping posting toggle, Stripe).';

alter table public.billing_settings enable row level security;

drop policy if exists billing_settings_firm_all on public.billing_settings;
create policy billing_settings_firm_all on public.billing_settings
  for all using (
    firm_id = (select u.firm_id from public.users u where u.id = auth.uid())
  ) with check (
    firm_id = (select u.firm_id from public.users u where u.id = auth.uid())
  );

-- ─── Invoices ────────────────────────────────────────────────────────────────
create table if not exists public.invoices (
  id                uuid primary key default gen_random_uuid(),
  firm_id           uuid not null references public.firms(id) on delete cascade,
  client_id         uuid references public.clients(id) on delete set null,
  client_name       text,                       -- denormalised label snapshot
  number            text,                        -- rendered at issue (prefix + seq)
  status            text not null default 'draft'
                      check (status in ('draft','sent','viewed','part_paid','paid','overdue','cancelled','bad_debt')),
  issue_date        date,
  due_date          date,
  currency          text not null default 'GBP',
  subtotal_pence    integer not null default 0,
  vat_pence         integer not null default 0,
  total_pence       integer not null default 0,
  amount_paid_pence integer not null default 0,
  notes             text,
  terms             text,
  source            text not null default 'manual'
                      check (source in ('manual','recurring','proposal','timesheet','advisory')),
  source_id         uuid,
  sent_at           timestamptz,
  viewed_at         timestamptz,
  paid_at           timestamptz,
  created_by        uuid references public.users(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists invoices_firm_status_idx on public.invoices (firm_id, status);
create index if not exists invoices_firm_due_idx    on public.invoices (firm_id, due_date);
create index if not exists invoices_client_idx      on public.invoices (client_id);

comment on table public.invoices is
  'Billing module — one row per invoice. Balance = total_pence - amount_paid_pence (computed in app).';

alter table public.invoices enable row level security;

drop policy if exists invoices_firm_all on public.invoices;
create policy invoices_firm_all on public.invoices
  for all using (
    firm_id = (select u.firm_id from public.users u where u.id = auth.uid())
  ) with check (
    firm_id = (select u.firm_id from public.users u where u.id = auth.uid())
  );

-- ─── Invoice lines ───────────────────────────────────────────────────────────
create table if not exists public.invoice_lines (
  id              uuid primary key default gen_random_uuid(),
  invoice_id      uuid not null references public.invoices(id) on delete cascade,
  firm_id         uuid not null references public.firms(id) on delete cascade,
  description     text not null default '',
  quantity        numeric not null default 1,
  unit_price_pence integer not null default 0,
  vat_rate        numeric not null default 0,
  net_pence       integer not null default 0,
  vat_pence       integer not null default 0,
  gross_pence     integer not null default 0,
  service_id      uuid,                          -- optional saved-service link
  time_entry_ids  uuid[],                        -- when billed from Timesheets
  position        integer not null default 0,
  created_at      timestamptz not null default now()
);

create index if not exists invoice_lines_invoice_idx on public.invoice_lines (invoice_id);

alter table public.invoice_lines enable row level security;

drop policy if exists invoice_lines_firm_all on public.invoice_lines;
create policy invoice_lines_firm_all on public.invoice_lines
  for all using (
    firm_id = (select u.firm_id from public.users u where u.id = auth.uid())
  ) with check (
    firm_id = (select u.firm_id from public.users u where u.id = auth.uid())
  );

-- ─── Payments ────────────────────────────────────────────────────────────────
create table if not exists public.payments (
  id            uuid primary key default gen_random_uuid(),
  firm_id       uuid not null references public.firms(id) on delete cascade,
  client_id     uuid references public.clients(id) on delete set null,
  method        text not null default 'manual'
                  check (method in ('manual','stripe_card','stripe_bacs_dd','csv_import')),
  amount_pence  integer not null check (amount_pence > 0),
  received_date date not null,
  reference     text,
  provider_ref  text,
  matched       boolean not null default false,
  matched_by    text check (matched_by in ('ai','user')),
  created_by    uuid references public.users(id) on delete set null,
  created_at    timestamptz not null default now()
);

create index if not exists payments_firm_idx   on public.payments (firm_id, received_date);
create index if not exists payments_client_idx on public.payments (client_id);

alter table public.payments enable row level security;

drop policy if exists payments_firm_all on public.payments;
create policy payments_firm_all on public.payments
  for all using (
    firm_id = (select u.firm_id from public.users u where u.id = auth.uid())
  ) with check (
    firm_id = (select u.firm_id from public.users u where u.id = auth.uid())
  );

-- ─── Payment allocations (a payment split across one or more invoices) ────────
create table if not exists public.payment_allocations (
  id           uuid primary key default gen_random_uuid(),
  firm_id      uuid not null references public.firms(id) on delete cascade,
  payment_id   uuid not null references public.payments(id) on delete cascade,
  invoice_id   uuid not null references public.invoices(id) on delete cascade,
  amount_pence integer not null check (amount_pence > 0),
  created_at   timestamptz not null default now()
);

create index if not exists payment_allocations_payment_idx on public.payment_allocations (payment_id);
create index if not exists payment_allocations_invoice_idx on public.payment_allocations (invoice_id);

alter table public.payment_allocations enable row level security;

drop policy if exists payment_allocations_firm_all on public.payment_allocations;
create policy payment_allocations_firm_all on public.payment_allocations
  for all using (
    firm_id = (select u.firm_id from public.users u where u.id = auth.uid())
  ) with check (
    firm_id = (select u.firm_id from public.users u where u.id = auth.uid())
  );

-- ─── Credit notes ────────────────────────────────────────────────────────────
create table if not exists public.credit_notes (
  id           uuid primary key default gen_random_uuid(),
  firm_id      uuid not null references public.firms(id) on delete cascade,
  client_id    uuid references public.clients(id) on delete set null,
  invoice_id   uuid references public.invoices(id) on delete set null,
  number       text,
  amount_pence integer not null check (amount_pence > 0),
  reason       text,
  status       text not null default 'issued'
                 check (status in ('draft','issued','applied','cancelled')),
  created_by   uuid references public.users(id) on delete set null,
  created_at   timestamptz not null default now()
);

create index if not exists credit_notes_firm_idx    on public.credit_notes (firm_id);
create index if not exists credit_notes_invoice_idx on public.credit_notes (invoice_id);

alter table public.credit_notes enable row level security;

drop policy if exists credit_notes_firm_all on public.credit_notes;
create policy credit_notes_firm_all on public.credit_notes
  for all using (
    firm_id = (select u.firm_id from public.users u where u.id = auth.uid())
  ) with check (
    firm_id = (select u.firm_id from public.users u where u.id = auth.uid())
  );

-- ─── Invoice letterhead / remittance details (on billing_settings) ────────────
-- The firm's own "from" block + bank details for the invoice PDF. Kept here
-- (not in accounts_studio settings) so Billing is self-contained.
alter table public.billing_settings
  add column if not exists business_name    text not null default '',
  add column if not exists business_address text not null default '',
  add column if not exists vat_number       text not null default '',
  add column if not exists bank_details     text not null default '',
  add column if not exists invoice_footer   text not null default '';
