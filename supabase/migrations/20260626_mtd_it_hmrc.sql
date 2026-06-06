-- ============================================================
--  MTD IT (Income Tax) HMRC submission — Phase A foundation
-- ============================================================
--  Adds the identifiers + connection plumbing needed to file Income Tax
--  quarterly updates to HMRC. No live calls yet — this is the schema layer.
--
--  • clients: NINO + UTR already exist (national_insurance_number / utr_number)
--    and are reused as-is — no new identifier columns needed.
--  • mtd_it_trades / mtd_it_properties: the HMRC businessId per income source.
--  • hmrc_connections: generalised from VAT-only to multi-service. Adds a
--    `service` discriminator ('vat' | 'mtd_it'), a `client_id` for per-client
--    'individual' connections, and a new 'individual' kind. Uniqueness becomes
--    service-aware so a firm can hold BOTH a VAT agent connection and an MTD-IT
--    agent connection.
--  • mtd_it_submissions: receipts of what was filed (audit trail).
--
--  Idempotent — safe to re-run.
-- ============================================================

-- ── Client HMRC identifiers ─────────────────────────────────────────────────
-- NINO + UTR already exist as clients.national_insurance_number / utr_number —
-- reused directly, so nothing to add here.

-- ── Per-business-source HMRC businessId ─────────────────────────────────────
alter table public.mtd_it_trades
  add column if not exists hmrc_business_id text;       -- ^X[A-Z0-9]IS[0-9]{11}$
alter table public.mtd_it_properties
  add column if not exists hmrc_business_id text;

-- ── Generalise hmrc_connections (VAT-only → multi-service) ───────────────────
alter table public.hmrc_connections
  add column if not exists service   text not null default 'vat',
  add column if not exists client_id uuid references public.clients(id) on delete cascade;

-- Allow the new 'individual' kind; constrain service values.
alter table public.hmrc_connections drop constraint if exists hmrc_connections_kind_check;
alter table public.hmrc_connections
  add constraint hmrc_connections_kind_check check (kind in ('agent','business','individual'));
do $$ begin
  alter table public.hmrc_connections
    add constraint hmrc_connections_service_check check (service in ('vat','mtd_it'));
exception when duplicate_object then null; end $$;

-- Service-aware uniqueness: one agent connection per (firm, service); one
-- business connection per (book, service); one individual connection per
-- (client, service). Replaces the old service-blind indexes.
drop index if exists hmrc_connections_firm_agent_uidx;
drop index if exists hmrc_connections_book_business_uidx;
create unique index if not exists hmrc_connections_firm_agent_svc_uidx
  on public.hmrc_connections(firm_id, service) where kind = 'agent';
create unique index if not exists hmrc_connections_book_business_svc_uidx
  on public.hmrc_connections(book_id, service) where kind = 'business';
create unique index if not exists hmrc_connections_client_individual_svc_uidx
  on public.hmrc_connections(client_id, service) where kind = 'individual';

-- ── MTD IT submission receipts ──────────────────────────────────────────────
create table if not exists public.mtd_it_submissions (
  id               uuid primary key default gen_random_uuid(),
  quarter_id       uuid not null references public.mtd_it_quarters(id) on delete cascade,
  client_id        uuid not null references public.clients(id) on delete cascade,
  business_id      text not null,             -- HMRC businessId filed against
  type_of_business text not null,             -- self-employment | uk-property | foreign-property
  tax_year         text not null,             -- '2025-26'
  period_to        date  not null,            -- YTD end (obligation period end met)
  payload          jsonb not null,            -- exact body PUT to HMRC
  hmrc_status      int,                       -- HTTP status returned
  hmrc_response    jsonb,                     -- receipt / error body
  submitted_by     uuid references public.users(id),
  submitted_at     timestamptz not null default now()
);

create index if not exists mtd_it_submissions_quarter_idx
  on public.mtd_it_submissions(quarter_id, submitted_at desc);
create index if not exists mtd_it_submissions_client_idx
  on public.mtd_it_submissions(client_id, submitted_at desc);

alter table public.mtd_it_submissions enable row level security;

create policy "mtd_it_submissions_same_firm"
  on public.mtd_it_submissions for all
  using (exists (
    select 1 from public.clients c
    where c.id = mtd_it_submissions.client_id and c.firm_id = public.my_firm_id()
  ))
  with check (exists (
    select 1 from public.clients c
    where c.id = mtd_it_submissions.client_id and c.firm_id = public.my_firm_id()
  ));
