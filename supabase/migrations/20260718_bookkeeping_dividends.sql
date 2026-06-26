-- Bookkeeping — dividends (Phase 3 of docs/people-and-entities.md).
--
-- A Ltd company declares a dividend; it's split across the shareholder
-- participants by their shareholding %, snapshotted at declaration time (so the
-- record survives later changes to holdings). Drives the dividend vouchers and
-- board meeting minutes.

create table if not exists public.bookkeeping_dividends (
  id               uuid primary key default gen_random_uuid(),
  book_id          uuid not null references public.bookkeeping_books(id) on delete cascade,
  firm_id          uuid not null references public.firms(id) on delete cascade,
  dividend_type    text not null default 'interim' check (dividend_type in ('interim', 'final')),
  declaration_date date not null,
  payment_date     date,
  tax_year         text,
  total_amount     numeric not null,
  notes            text,
  created_at       timestamptz not null default now(),
  created_by       uuid references public.users(id) on delete set null
);

create index if not exists bookkeeping_dividends_book_idx
  on public.bookkeeping_dividends (book_id, declaration_date desc);

create table if not exists public.bookkeeping_dividend_recipients (
  id               uuid primary key default gen_random_uuid(),
  dividend_id      uuid not null references public.bookkeeping_dividends(id) on delete cascade,
  firm_id          uuid not null references public.firms(id) on delete cascade,
  participant_id   uuid references public.bookkeeping_book_participants(id) on delete set null,
  name             text not null,
  shareholding_pct numeric,
  amount           numeric not null
);

create index if not exists bookkeeping_dividend_recipients_div_idx
  on public.bookkeeping_dividend_recipients (dividend_id);

comment on table public.bookkeeping_dividends is
  'Declared dividends for a Ltd book; split across shareholder participants (snapshotted in bookkeeping_dividend_recipients). Drives dividend vouchers + board minutes.';

-- ── RLS (firm-scoped; all access via the user client) ────────────────────────
alter table public.bookkeeping_dividends enable row level security;
drop policy if exists bd_firm_all on public.bookkeeping_dividends;
create policy bd_firm_all on public.bookkeeping_dividends
  for all using (firm_id = (select u.firm_id from public.users u where u.id = auth.uid()))
  with check (firm_id = (select u.firm_id from public.users u where u.id = auth.uid()));

alter table public.bookkeeping_dividend_recipients enable row level security;
drop policy if exists bdr_firm_all on public.bookkeeping_dividend_recipients;
create policy bdr_firm_all on public.bookkeeping_dividend_recipients
  for all using (firm_id = (select u.firm_id from public.users u where u.id = auth.uid()))
  with check (firm_id = (select u.firm_id from public.users u where u.id = auth.uid()));
