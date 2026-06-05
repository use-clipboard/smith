-- ============================================================
--  HMRC MTD connections — Stage 1 foundation
-- ============================================================
--  Stores the OAuth connection (per firm for agents, per book for
--  businesses) that future MTD VAT submission will use. No live HMRC
--  calls exist yet — this table + the env-gated UI are the scaffold.
--
--  Two connection kinds (SMITH is sold to firms that may be either):
--    • 'agent'    — the firm connects once via its HMRC Agent Services
--                   Account and submits for every client it's authorised
--                   for. One row per firm; book_id is null.
--    • 'business' — a single business authorises SMITH to file its own
--                   VAT. One row per book, tied to that book's VRN.
--
--  Tokens are written and read SERVER-SIDE ONLY via the service role.
--  RLS is enabled with NO user policies, so the anon/auth client can
--  never read access/refresh tokens — only the server (service role,
--  which bypasses RLS) touches this table.
-- ============================================================

create table if not exists public.hmrc_connections (
  id              uuid primary key default gen_random_uuid(),
  firm_id         uuid not null references public.firms(id) on delete cascade,
  kind            text not null check (kind in ('agent','business')),

  -- For 'business' connections: the book (and its VRN) this token files for.
  -- Null for 'agent' connections (they cover all authorised clients).
  book_id         uuid references public.bookkeeping_books(id) on delete cascade,
  vrn             text,

  -- OAuth material. Populated in Stage 2 (live integration) — null until then.
  access_token    text,
  refresh_token   text,
  token_expiry    timestamptz,
  scopes          text,

  status          text not null default 'disconnected'
                    check (status in ('disconnected','connected','expired','revoked')),

  connected_by    uuid references public.users(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- One agent connection per firm; one business connection per book.
create unique index if not exists hmrc_connections_firm_agent_uidx
  on public.hmrc_connections(firm_id) where kind = 'agent';
create unique index if not exists hmrc_connections_book_business_uidx
  on public.hmrc_connections(book_id) where kind = 'business';

comment on table public.hmrc_connections is
  'HMRC MTD OAuth connections. kind=agent → one per firm (ASA, all authorised clients); kind=business → one per book. Tokens are service-role only — RLS denies all direct client access.';

-- RLS on, NO policies → only the service role (server-side) can read/write.
-- Protects the access/refresh tokens from ever reaching the browser.
alter table public.hmrc_connections enable row level security;
