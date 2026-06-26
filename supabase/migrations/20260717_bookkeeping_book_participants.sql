-- Bookkeeping — book participants (people behind the entity).
--
-- Links the individuals behind a set of books — partners, the sole trader,
-- directors, shareholders — to their records, so SMITH can later flow
-- profit-share / dividends / salary into each person's self-assessment and
-- generate dividend vouchers + meeting minutes. See docs/people-and-entities.md.
--
-- The person comes from one of three sources (the picker): an existing
-- client-link, a client key contact, or hard-entered. We deliberately do NOT
-- introduce a global people table — a tax-relevant person is usually already a
-- client record (referenced via linked_client_id), the bridge to self-assessment.

create table if not exists public.bookkeeping_book_participants (
  id                 uuid primary key default gen_random_uuid(),
  book_id            uuid not null references public.bookkeeping_books(id) on delete cascade,
  firm_id            uuid not null references public.firms(id) on delete cascade,
  role               text not null check (role in ('partner', 'sole_trader', 'director', 'shareholder')),
  -- Where the person came from (the 3-source picker).
  source_type        text not null default 'manual' check (source_type in ('client_link', 'key_contact', 'manual')),
  linked_client_id   uuid references public.clients(id) on delete set null,
  name               text not null,
  -- Role attributes.
  profit_share_pct   numeric,   -- partnership / LLP profit allocation
  shareholding_pct   numeric,   -- shareholder dividends
  shares_held        numeric,   -- optional alternative to a %
  annual_salary      numeric,   -- director salary (informational for now)
  -- Optional mapping to the per-partner capital ledger account (e.g. P1..P9).
  capital_account_id uuid references public.bookkeeping_accounts(id) on delete set null,
  -- Shares / profit-share change year to year.
  effective_from     date,
  effective_to       date,
  created_at         timestamptz not null default now(),
  created_by         uuid references public.users(id) on delete set null
);

create index if not exists bookkeeping_book_participants_book_idx
  on public.bookkeeping_book_participants (book_id);

comment on table public.bookkeeping_book_participants is
  'People attached to a set of books (partner/sole_trader/director/shareholder) with role attributes (profit-share %, shareholding %, salary) and an optional link to a client record. Foundation for profit allocation, dividend vouchers, minutes and self-assessment feeds.';

alter table public.bookkeeping_book_participants enable row level security;

drop policy if exists bbp_firm_all on public.bookkeeping_book_participants;
create policy bbp_firm_all on public.bookkeeping_book_participants
  for all using (
    firm_id = (select u.firm_id from public.users u where u.id = auth.uid())
  ) with check (
    firm_id = (select u.firm_id from public.users u where u.id = auth.uid())
  );

-- Client links can carry an ownership/shareholding % (e.g. a Shareholder or
-- Partner link), shown in the client's Links section and used to default a
-- participant's shareholding_pct.
alter table public.client_links
  add column if not exists ownership_percentage numeric;
