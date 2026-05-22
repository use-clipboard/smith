-- ============================================================
--  Bookkeeping tool — Phase 0 schema (gating shell only)
-- ============================================================
--  This migration sets up the foundation tables for the new
--  VT Transaction+ inspired bookkeeping module. Phase 0 is
--  gating + structure only — no transactions, no splits, no
--  matches yet (those land in Phase 2).
--
--  Tables:
--    bookkeeping_books              — a "set of books" tied to a client (or unallocated)
--    bookkeeping_coa_templates      — firm-wide master Chart of Accounts per template type
--    bookkeeping_accounts           — per-book COA (seeded from the firm template)
--    bookkeeping_book_permissions   — per-user-per-book role override
--    bookkeeping_audit              — silent change log, viewable on demand
-- ============================================================

-- ── Books ───────────────────────────────────────────────────
create table if not exists public.bookkeeping_books (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references public.firms on delete cascade,
  client_id uuid references public.clients on delete set null,  -- NULL = unallocated
  name text not null,
  template_type text not null check (template_type in
    ('basic','ltd','llp','partnership','self_employed','sole_trader','trust','charity')),
  base_currency text not null default 'GBP',
  vat_registered boolean not null default false,
  vat_scheme text check (vat_scheme in
    ('standard','flat_rate','cash','annual','margin','partial_exemption')),
  vat_number text,
  period_lock_date date,
  admin_locked boolean not null default false,
  archived boolean not null default false,
  created_by uuid references public.users on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists bookkeeping_books_firm_idx
  on public.bookkeeping_books (firm_id, archived, created_at desc);
create index if not exists bookkeeping_books_client_idx
  on public.bookkeeping_books (client_id) where client_id is not null;

alter table public.bookkeeping_books enable row level security;

-- All firm members can read the firm's books (unallocated included)
create policy "books: same firm read"
  on public.bookkeeping_books for select
  using (firm_id = public.my_firm_id());

-- Any firm member can create books; admin_locked books are write-restricted via app logic + audit
create policy "books: firm members write"
  on public.bookkeeping_books for all
  using (firm_id = public.my_firm_id())
  with check (firm_id = public.my_firm_id());

-- ── Firm-wide COA templates ─────────────────────────────────
create table if not exists public.bookkeeping_coa_templates (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references public.firms on delete cascade,
  template_type text not null check (template_type in
    ('basic','ltd','llp','partnership','self_employed','sole_trader','trust','charity')),
  name text not null,
  account_type text not null check (account_type in
    ('asset','liability','equity','income','expense')),
  sort_order int not null default 0,
  is_system boolean not null default false,
  created_at timestamptz not null default now(),
  unique (firm_id, template_type, name)
);
create index if not exists bookkeeping_coa_templates_firm_idx
  on public.bookkeeping_coa_templates (firm_id, template_type, sort_order);

alter table public.bookkeeping_coa_templates enable row level security;

create policy "coa_templates: same firm read"
  on public.bookkeeping_coa_templates for select
  using (firm_id = public.my_firm_id());

create policy "coa_templates: admin write"
  on public.bookkeeping_coa_templates for all
  using (firm_id = public.my_firm_id()
         and exists (select 1 from public.users where id = auth.uid() and role = 'admin'))
  with check (firm_id = public.my_firm_id()
              and exists (select 1 from public.users where id = auth.uid() and role = 'admin'));

-- ── Per-book accounts (seeded from template, freely editable) ──
create table if not exists public.bookkeeping_accounts (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references public.bookkeeping_books on delete cascade,
  name text not null,
  account_type text not null check (account_type in
    ('asset','liability','equity','income','expense')),
  sort_order int not null default 0,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  unique (book_id, name)
);
create index if not exists bookkeeping_accounts_book_idx
  on public.bookkeeping_accounts (book_id, archived, sort_order);

alter table public.bookkeeping_accounts enable row level security;

-- Access inherits from the parent book's firm
create policy "accounts: same firm via book"
  on public.bookkeeping_accounts for all
  using (exists (
    select 1 from public.bookkeeping_books b
    where b.id = bookkeeping_accounts.book_id
      and b.firm_id = public.my_firm_id()
  ))
  with check (exists (
    select 1 from public.bookkeeping_books b
    where b.id = bookkeeping_accounts.book_id
      and b.firm_id = public.my_firm_id()
  ));

-- ── Per-book permissions (overrides; absence = firm default) ──
create table if not exists public.bookkeeping_book_permissions (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references public.bookkeeping_books on delete cascade,
  user_id uuid not null references public.users on delete cascade,
  role text not null check (role in ('viewer','bookkeeper','reviewer','admin')),
  created_at timestamptz not null default now(),
  unique (book_id, user_id)
);
create index if not exists bookkeeping_book_permissions_book_idx
  on public.bookkeeping_book_permissions (book_id);
create index if not exists bookkeeping_book_permissions_user_idx
  on public.bookkeeping_book_permissions (user_id);

alter table public.bookkeeping_book_permissions enable row level security;

-- Read access for any firm member of the book's firm; admins can write
create policy "book_perms: same firm read"
  on public.bookkeeping_book_permissions for select
  using (exists (
    select 1 from public.bookkeeping_books b
    where b.id = bookkeeping_book_permissions.book_id
      and b.firm_id = public.my_firm_id()
  ));

create policy "book_perms: admin write"
  on public.bookkeeping_book_permissions for all
  using (exists (
    select 1 from public.bookkeeping_books b
    where b.id = bookkeeping_book_permissions.book_id
      and b.firm_id = public.my_firm_id()
  ) and exists (select 1 from public.users where id = auth.uid() and role = 'admin'))
  with check (exists (
    select 1 from public.bookkeeping_books b
    where b.id = bookkeeping_book_permissions.book_id
      and b.firm_id = public.my_firm_id()
  ) and exists (select 1 from public.users where id = auth.uid() and role = 'admin'));

-- ── Silent audit log ───────────────────────────────────────
-- One row per change. UI surfaces these only on demand (per-row
-- "History" link) so the default screen stays clean.
create table if not exists public.bookkeeping_audit (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references public.bookkeeping_books on delete cascade,
  user_id uuid references public.users on delete set null,
  entity_type text not null check (entity_type in
    ('book','account','transaction','journal','period_lock','permission','coa_template')),
  entity_id uuid,
  action text not null check (action in
    ('create','update','delete','lock','unlock','post','unpost','archive','unarchive')),
  diff jsonb,
  created_at timestamptz not null default now()
);
create index if not exists bookkeeping_audit_book_idx
  on public.bookkeeping_audit (book_id, created_at desc);
create index if not exists bookkeeping_audit_entity_idx
  on public.bookkeeping_audit (entity_type, entity_id) where entity_id is not null;

alter table public.bookkeeping_audit enable row level security;

create policy "audit: same firm via book"
  on public.bookkeeping_audit for select
  using (exists (
    select 1 from public.bookkeeping_books b
    where b.id = bookkeeping_audit.book_id
      and b.firm_id = public.my_firm_id()
  ));

-- Inserts only — audit rows are immutable
create policy "audit: firm member insert"
  on public.bookkeeping_audit for insert
  with check (exists (
    select 1 from public.bookkeeping_books b
    where b.id = bookkeeping_audit.book_id
      and b.firm_id = public.my_firm_id()
  ));

-- ── Comments ──────────────────────────────────────────────
comment on table public.bookkeeping_books is
  'A "set of books" — one row per VT-equivalent file. Tied to a client when linked, NULL client_id for unallocated books.';
comment on table public.bookkeeping_coa_templates is
  'Firm-wide master Chart of Accounts templates. Seeded into bookkeeping_accounts when a new book is created.';
comment on table public.bookkeeping_accounts is
  'Per-book Chart of Accounts. Independently editable; changes do not flow back to the firm template unless explicitly promoted.';
comment on table public.bookkeeping_book_permissions is
  'Per-user-per-book role override. Absence = firm-default role. Only admins can write rows here.';
comment on table public.bookkeeping_audit is
  'Silent change log — every meaningful change writes one row. UI surfaces these only on the per-row History view.';
