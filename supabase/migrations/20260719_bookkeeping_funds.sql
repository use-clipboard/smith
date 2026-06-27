-- Bookkeeping — fund dimension (charity fund accounting).
--
-- Charity accounts (Charities SORP / FRS 102) are kept by FUND: every figure
-- belongs to an unrestricted, restricted or endowment fund. Rather than
-- duplicating the chart of accounts per fund, we add a fund as an orthogonal
-- dimension: a `bookkeeping_funds` table per book, and a nullable `fund_id` on
-- each transaction split. Any account can be used by any fund; the split's
-- fund_id is what produces a per-fund SOFA / balance sheet.
--
-- fund_id is NULLABLE and only ever populated for charity books — non-charity
-- books (ltd/sole/partnership/llp/trust) never set it and never see fund UI, so
-- this is a fully backwards-compatible, non-invasive addition.

create table if not exists public.bookkeeping_funds (
  id          uuid primary key default gen_random_uuid(),
  book_id     uuid not null references public.bookkeeping_books(id) on delete cascade,
  name        text not null,
  fund_type   text not null check (fund_type in ('unrestricted', 'restricted', 'endowment')),
  description text,
  sort_order  int  not null default 0,
  archived    boolean not null default false,
  created_by  uuid references public.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  -- Fund names are unique within a book.
  unique (book_id, name)
);

create index if not exists bookkeeping_funds_book_idx
  on public.bookkeeping_funds (book_id, sort_order);

comment on table public.bookkeeping_funds is
  'Charity fund accounting. One row per fund (unrestricted/restricted/endowment) on a book. Orthogonal to accounts — any account can be used by any fund; the split''s fund_id drives per-fund SOFA / fund balance sheets.';

alter table public.bookkeeping_funds enable row level security;

drop policy if exists "funds: same firm via book" on public.bookkeeping_funds;
create policy "funds: same firm via book"
  on public.bookkeeping_funds for all
  using (exists (
    select 1 from public.bookkeeping_books b
    where b.id = bookkeeping_funds.book_id
      and b.firm_id = public.my_firm_id()
  ))
  with check (exists (
    select 1 from public.bookkeeping_books b
    where b.id = bookkeeping_funds.book_id
      and b.firm_id = public.my_firm_id()
  ));

-- ── fund_id on the double-entry split lines ─────────────────────────────────
alter table public.bookkeeping_transaction_splits
  add column if not exists fund_id uuid references public.bookkeeping_funds(id) on delete restrict;

create index if not exists bookkeeping_transaction_splits_fund_idx
  on public.bookkeeping_transaction_splits (fund_id) where fund_id is not null;

comment on column public.bookkeeping_transaction_splits.fund_id is
  'Charity fund this line belongs to (NULL for non-charity books). Per-line so a single transaction can move money between funds (DR unrestricted / CR restricted).';
