-- ============================================================
--  MTD IT (Making Tax Digital for Income Tax) — Stage A schema
-- ============================================================
--  This migration introduces the data model required to support
--  per-client, per-quarter MTD IT preparation. Stage A wires up
--  the dashboard + expandable quarter panel only; later stages
--  populate the entries/documents tables via the analysis flow.
--
--  Tables:
--    mtd_it_trades       — multiple sole trades per client
--    mtd_it_properties   — UK / foreign rental properties per client
--    mtd_it_quarters     — one row per (client, tax_year, quarter)
--    mtd_it_entries      — analysed transactions per quarter
--    mtd_it_documents    — uploaded source documents per quarter
--
--  Adds columns to `clients`:
--    mtd_it_quarter_type     — 'calendar' or 'standard'
--    mtd_it_streams          — {sole, uk_rental, foreign_rental}
--    mtd_it_prior_year_income — used for threshold flagging
-- ============================================================

-- ── Client-level columns ────────────────────────────────────
alter table public.clients
  add column if not exists mtd_it_quarter_type text not null default 'calendar'
    check (mtd_it_quarter_type in ('calendar', 'standard'));

alter table public.clients
  add column if not exists mtd_it_streams jsonb not null
    default '{"sole":false,"uk_rental":false,"foreign_rental":false}'::jsonb;

alter table public.clients
  add column if not exists mtd_it_prior_year_income numeric;

-- ── Sole trades ─────────────────────────────────────────────
create table if not exists public.mtd_it_trades (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid not null references public.clients(id) on delete cascade,
  name        text not null,
  description text,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);
create index if not exists mtd_it_trades_client_idx on public.mtd_it_trades(client_id);
alter table public.mtd_it_trades enable row level security;

create policy "firm_access_mtd_it_trades"
  on public.mtd_it_trades for all
  using (client_id in (
    select id from public.clients
    where firm_id in (select firm_id from public.users where id = auth.uid())
  ));

-- ── Properties (UK + foreign rental) ────────────────────────
create table if not exists public.mtd_it_properties (
  id            uuid primary key default gen_random_uuid(),
  client_id     uuid not null references public.clients(id) on delete cascade,
  address       text not null,
  country       text,                                       -- ISO or freeform; only meaningful for foreign
  currency      text not null default 'GBP',
  ownership_pct numeric not null default 100
                check (ownership_pct >= 0 and ownership_pct <= 100),
  property_type text not null
                check (property_type in ('uk', 'foreign')),
  active        boolean not null default true,
  created_at    timestamptz not null default now()
);
create index if not exists mtd_it_properties_client_idx on public.mtd_it_properties(client_id);
alter table public.mtd_it_properties enable row level security;

create policy "firm_access_mtd_it_properties"
  on public.mtd_it_properties for all
  using (client_id in (
    select id from public.clients
    where firm_id in (select firm_id from public.users where id = auth.uid())
  ));

-- ── Quarters ────────────────────────────────────────────────
--  tax_year is stored as the starting year (e.g. 2026 for 2026/27)
--  quarter is 1..4 (Q1 = first quarter of the chosen quarter-type window)
--  status values reserve 'submitted' for the future HMRC API integration
create table if not exists public.mtd_it_quarters (
  id                uuid primary key default gen_random_uuid(),
  client_id         uuid not null references public.clients(id) on delete cascade,
  tax_year          int  not null check (tax_year >= 2026),
  quarter           int  not null check (quarter between 1 and 4),
  streams_snapshot  jsonb not null
                    default '{"sole":false,"uk_rental":false,"foreign_rental":false}'::jsonb,
  consolidated      boolean not null default false,
  fx_rates          jsonb not null default '{}'::jsonb,      -- { "USD": 1.27, ... }
  status            text not null default 'draft'
                    check (status in ('draft','complete','sent','approved','submitted')),
  notes             text,
  created_by        uuid references public.users(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (client_id, tax_year, quarter)
);
create index if not exists mtd_it_quarters_client_idx on public.mtd_it_quarters(client_id);
create index if not exists mtd_it_quarters_year_idx   on public.mtd_it_quarters(tax_year);
alter table public.mtd_it_quarters enable row level security;

create policy "firm_access_mtd_it_quarters"
  on public.mtd_it_quarters for all
  using (client_id in (
    select id from public.clients
    where firm_id in (select firm_id from public.users where id = auth.uid())
  ));

-- ── Entries (analysed + manual transactions) ────────────────
create table if not exists public.mtd_it_entries (
  id              uuid primary key default gen_random_uuid(),
  quarter_id      uuid not null references public.mtd_it_quarters(id) on delete cascade,
  stream          text not null check (stream in ('sole','uk_rental','foreign_rental')),
  trade_id        uuid references public.mtd_it_trades(id) on delete set null,
  property_id     uuid references public.mtd_it_properties(id) on delete set null,
  source_file_name text,
  page_number     int,
  entry_date      date,
  description     text,
  supplier        text,
  category        text,
  entry_type      text not null check (entry_type in ('income','expense')),
  gross_amount    numeric,
  net_amount      numeric,
  vat_amount      numeric,
  currency        text not null default 'GBP',
  fx_rate         numeric,
  gbp_amount      numeric,
  share_pct       numeric not null default 100
                  check (share_pct >= 0 and share_pct <= 100),
  manual          boolean not null default false,
  flagged_reason  text,
  drive_link      text,
  created_at      timestamptz not null default now()
);
create index if not exists mtd_it_entries_quarter_idx on public.mtd_it_entries(quarter_id);
create index if not exists mtd_it_entries_stream_idx  on public.mtd_it_entries(quarter_id, stream);
alter table public.mtd_it_entries enable row level security;

create policy "firm_access_mtd_it_entries"
  on public.mtd_it_entries for all
  using (quarter_id in (
    select id from public.mtd_it_quarters
    where client_id in (
      select id from public.clients
      where firm_id in (select firm_id from public.users where id = auth.uid())
    )
  ));

-- ── Documents (uploaded source files) ───────────────────────
create table if not exists public.mtd_it_documents (
  id            uuid primary key default gen_random_uuid(),
  quarter_id    uuid not null references public.mtd_it_quarters(id) on delete cascade,
  stream        text not null check (stream in ('sole','uk_rental','foreign_rental')),
  file_name     text not null,
  file_url      text,
  status        text not null default 'pending'
                check (status in ('pending','scanning','scanned','failed')),
  error_message text,
  created_at    timestamptz not null default now()
);
create index if not exists mtd_it_documents_quarter_idx on public.mtd_it_documents(quarter_id);
alter table public.mtd_it_documents enable row level security;

create policy "firm_access_mtd_it_documents"
  on public.mtd_it_documents for all
  using (quarter_id in (
    select id from public.mtd_it_quarters
    where client_id in (
      select id from public.clients
      where firm_id in (select firm_id from public.users where id = auth.uid())
    )
  ));
