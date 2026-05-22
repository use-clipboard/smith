-- ============================================================
--  Bookkeeping tool — Phase 2A schema
-- ============================================================
--  Adds the real transactional data model so books can hold
--  actual bookkeeping data. UI for entry comes in Phase 2B–2D.
--
--  New tables:
--    bookkeeping_transactions          — one row per transaction (the header)
--    bookkeeping_transaction_splits    — per-transaction debit/credit lines
--    bookkeeping_payee_memory          — per-book memorisation of payee → split template
--    bookkeeping_matches               — allocation header (links splits together)
--    bookkeeping_match_lines           — which splits are bundled in a match
--    bookkeeping_ref_counters          — per-book per-type monotonic ref sequence
--
--  Also:
--    Adds `ledger` to bookkeeping_accounts (and the COA template table) so VT-
--    style ledger grouping (Income, Cost of sales, Expenses, FA - intangible…)
--    is first-class. Reworks the uniqueness so (book_id, ledger, name) is
--    unique — names like "Brought forward" or "Cost - b/fwd" repeat across
--    ledgers and must be allowed.
-- ============================================================

-- ── Ledger column on COA tables ─────────────────────────────
alter table public.bookkeeping_accounts
  add column if not exists ledger text;

alter table public.bookkeeping_coa_templates
  add column if not exists ledger text;

-- Old uniqueness was (book_id, name) — break it; names repeat across ledgers.
do $$
declare cn text;
begin
  for cn in
    select conname from pg_constraint
    where conrelid = 'public.bookkeeping_accounts'::regclass
      and contype = 'u'
      and pg_get_constraintdef(oid) ilike '%(book_id, name)%'
  loop
    execute format('alter table public.bookkeeping_accounts drop constraint %I', cn);
  end loop;
end$$;

do $$
declare cn text;
begin
  for cn in
    select conname from pg_constraint
    where conrelid = 'public.bookkeeping_coa_templates'::regclass
      and contype = 'u'
      and pg_get_constraintdef(oid) ilike '%(firm_id, template_type, name)%'
  loop
    execute format('alter table public.bookkeeping_coa_templates drop constraint %I', cn);
  end loop;
end$$;

-- New uniqueness — ledger-scoped names.
alter table public.bookkeeping_accounts
  add constraint bookkeeping_accounts_book_ledger_name_uq
  unique (book_id, ledger, name);

alter table public.bookkeeping_coa_templates
  add constraint bookkeeping_coa_templates_firm_type_ledger_name_uq
  unique (firm_id, template_type, ledger, name);

create index if not exists bookkeeping_accounts_book_ledger_idx
  on public.bookkeeping_accounts (book_id, ledger, sort_order);

comment on column public.bookkeeping_accounts.ledger is
  'VT-style ledger grouping (Income, Cost of sales, Expenses, FA - intangible, etc.). Display label only — sort/grouping driver. account_type holds the accounting category for reports.';

-- ── Transactions (the header) ───────────────────────────────
create table if not exists public.bookkeeping_transactions (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references public.bookkeeping_books on delete cascade,
  type text not null check (type in
    ('PAY','CHQ','REC','SIN','SCR','PIN','PCR','JRN','TRF')),
  ref_no text not null,                 -- display, e.g. "PAY 001528"
  ref_seq int  not null,                -- numeric part, monotonic per (book, type)
  date date not null,
  payee_text text,                      -- free-text payee/payer as entered (for memorisation)
  details text,
  total numeric(15,2) not null default 0,
  vat_total numeric(15,2) not null default 0,
  vat_rate numeric(5,2),                -- 0, 5, 20, etc. NULL when not applicable
  vat_treatment text,                   -- 'no_vat','standard_20','reduced_5','zero','exempt','outside_scope'
  primary_account_id uuid references public.bookkeeping_accounts on delete restrict,
  -- ^ the bank for PAY/CHQ/REC, the customer for SIN/SCR, the supplier for PIN/PCR.
  --   NULL for JRN (purely in splits).
  status text not null default 'posted' check (status in ('posted','draft')),
  created_by uuid references public.users on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  posted_at  timestamptz,
  unique (book_id, type, ref_seq)
);
create index if not exists bookkeeping_transactions_book_date_idx
  on public.bookkeeping_transactions (book_id, date desc, created_at desc);
create index if not exists bookkeeping_transactions_book_type_seq_idx
  on public.bookkeeping_transactions (book_id, type, ref_seq desc);
create index if not exists bookkeeping_transactions_primary_account_idx
  on public.bookkeeping_transactions (primary_account_id) where primary_account_id is not null;
create index if not exists bookkeeping_transactions_payee_idx
  on public.bookkeeping_transactions (book_id, payee_text) where payee_text is not null;

alter table public.bookkeeping_transactions enable row level security;

create policy "txns: same firm via book"
  on public.bookkeeping_transactions for all
  using (exists (
    select 1 from public.bookkeeping_books b
    where b.id = bookkeeping_transactions.book_id
      and b.firm_id = public.my_firm_id()
  ))
  with check (exists (
    select 1 from public.bookkeeping_books b
    where b.id = bookkeeping_transactions.book_id
      and b.firm_id = public.my_firm_id()
  ));

comment on table public.bookkeeping_transactions is
  'One row per bookkeeping transaction. ref_seq is monotonic per (book, type) — never decrements on delete, gaps in the sequence ARE the audit trail.';

-- ── Splits (the double-entry lines) ─────────────────────────
create table if not exists public.bookkeeping_transaction_splits (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid not null references public.bookkeeping_transactions on delete cascade,
  line_no int not null,                -- 1-based ordering within the transaction
  account_id uuid not null references public.bookkeeping_accounts on delete restrict,
  debit  numeric(15,2) not null default 0,
  credit numeric(15,2) not null default 0,
  entry_details text,
  notes text,
  created_at timestamptz not null default now(),
  check (debit >= 0 and credit >= 0),
  check (debit = 0 or credit = 0)      -- a line is either a debit OR a credit, never both
);
create index if not exists bookkeeping_transaction_splits_txn_idx
  on public.bookkeeping_transaction_splits (transaction_id, line_no);
create index if not exists bookkeeping_transaction_splits_account_idx
  on public.bookkeeping_transaction_splits (account_id);

alter table public.bookkeeping_transaction_splits enable row level security;

create policy "splits: same firm via book"
  on public.bookkeeping_transaction_splits for all
  using (exists (
    select 1 from public.bookkeeping_transactions t
    join public.bookkeeping_books b on b.id = t.book_id
    where t.id = bookkeeping_transaction_splits.transaction_id
      and b.firm_id = public.my_firm_id()
  ))
  with check (exists (
    select 1 from public.bookkeeping_transactions t
    join public.bookkeeping_books b on b.id = t.book_id
    where t.id = bookkeeping_transaction_splits.transaction_id
      and b.firm_id = public.my_firm_id()
  ));

comment on table public.bookkeeping_transaction_splits is
  'Per-transaction double-entry lines. Each line is exclusively a debit OR a credit. Sum of debits = sum of credits per transaction (enforced in app code on post).';

-- ── Per-book per-type reference counter ─────────────────────
-- Monotonic. Never decrements. Deleting a transaction leaves a gap in the
-- sequence — that gap IS the audit trail. The bookkeeping_audit row tells you
-- who deleted PAY 001528 and when.
create table if not exists public.bookkeeping_ref_counters (
  book_id uuid not null references public.bookkeeping_books on delete cascade,
  type text not null check (type in
    ('PAY','CHQ','REC','SIN','SCR','PIN','PCR','JRN','TRF')),
  next_seq int not null default 1 check (next_seq >= 1),
  updated_at timestamptz not null default now(),
  primary key (book_id, type)
);
alter table public.bookkeeping_ref_counters enable row level security;

create policy "ref_counters: same firm via book"
  on public.bookkeeping_ref_counters for all
  using (exists (
    select 1 from public.bookkeeping_books b
    where b.id = bookkeeping_ref_counters.book_id
      and b.firm_id = public.my_firm_id()
  ))
  with check (exists (
    select 1 from public.bookkeeping_books b
    where b.id = bookkeeping_ref_counters.book_id
      and b.firm_id = public.my_firm_id()
  ));

-- Atomic ref allocation. App code calls this in a transaction with the
-- transaction insert so we never hand out a duplicate ref.
create or replace function public.bookkeeping_next_ref(p_book_id uuid, p_type text)
returns int
language plpgsql
as $$
declare v_seq int;
begin
  insert into public.bookkeeping_ref_counters (book_id, type, next_seq)
    values (p_book_id, p_type, 1)
    on conflict (book_id, type) do nothing;

  update public.bookkeeping_ref_counters
    set next_seq = next_seq + 1,
        updated_at = now()
    where book_id = p_book_id and type = p_type
    returning next_seq - 1 into v_seq;

  return v_seq;
end$$;

comment on function public.bookkeeping_next_ref is
  'Atomically allocate the next reference number for (book, type). Monotonic — never reuses a number, even after a delete.';

-- ── Payee memorisation ──────────────────────────────────────
-- Per-book by default. When a transaction is posted for a payee not seen
-- before, app code inserts a row. When seen again, it updates last_used_at
-- and use_count, and may refresh the template if the user changed the split.
create table if not exists public.bookkeeping_payee_memory (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references public.bookkeeping_books on delete cascade,
  transaction_type text not null check (transaction_type in
    ('PAY','CHQ','REC','SIN','SCR','PIN','PCR','JRN','TRF')),
  payee_key text not null,             -- normalised: lower(trim(payee_text))
  payee_display text not null,         -- pretty display as last typed
  last_used_at timestamptz not null default now(),
  use_count int not null default 1,
  template jsonb not null default '{}'::jsonb,
  -- ^ { vat_rate, vat_treatment, splits: [{ account_id, ratio_pct, entry_details }] }
  --   When all of a payee's past splits use the same account at the same ratio,
  --   this is the auto-fill suggestion.
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (book_id, transaction_type, payee_key)
);
create index if not exists bookkeeping_payee_memory_book_recent_idx
  on public.bookkeeping_payee_memory (book_id, last_used_at desc);

alter table public.bookkeeping_payee_memory enable row level security;

create policy "payee_memory: same firm via book"
  on public.bookkeeping_payee_memory for all
  using (exists (
    select 1 from public.bookkeeping_books b
    where b.id = bookkeeping_payee_memory.book_id
      and b.firm_id = public.my_firm_id()
  ))
  with check (exists (
    select 1 from public.bookkeeping_books b
    where b.id = bookkeeping_payee_memory.book_id
      and b.firm_id = public.my_firm_id()
  ));

comment on table public.bookkeeping_payee_memory is
  'Per-book memorisation. payee_key is the normalised lookup key (lowercased, trimmed). template stores the default split suggestion shown when the same payee is typed again.';

-- ── Matches (Phase 4 will USE these — table lands now for stability) ─────
create table if not exists public.bookkeeping_matches (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references public.bookkeeping_books on delete cascade,
  status text not null check (status in ('full','partial','write_off')),
  notes text,
  created_by uuid references public.users on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists bookkeeping_matches_book_idx
  on public.bookkeeping_matches (book_id, created_at desc);

alter table public.bookkeeping_matches enable row level security;

create policy "matches: same firm via book"
  on public.bookkeeping_matches for all
  using (exists (
    select 1 from public.bookkeeping_books b
    where b.id = bookkeeping_matches.book_id
      and b.firm_id = public.my_firm_id()
  ))
  with check (exists (
    select 1 from public.bookkeeping_books b
    where b.id = bookkeeping_matches.book_id
      and b.firm_id = public.my_firm_id()
  ));

create table if not exists public.bookkeeping_match_lines (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.bookkeeping_matches on delete cascade,
  split_id uuid not null references public.bookkeeping_transaction_splits on delete cascade,
  unique (match_id, split_id)
);
create index if not exists bookkeeping_match_lines_split_idx
  on public.bookkeeping_match_lines (split_id);

alter table public.bookkeeping_match_lines enable row level security;

create policy "match_lines: same firm via match"
  on public.bookkeeping_match_lines for all
  using (exists (
    select 1 from public.bookkeeping_matches m
    join public.bookkeeping_books b on b.id = m.book_id
    where m.id = bookkeeping_match_lines.match_id
      and b.firm_id = public.my_firm_id()
  ))
  with check (exists (
    select 1 from public.bookkeeping_matches m
    join public.bookkeeping_books b on b.id = m.book_id
    where m.id = bookkeeping_match_lines.match_id
      and b.firm_id = public.my_firm_id()
  ));

comment on table public.bookkeeping_matches is
  'Allocation header — links transaction-splits together. status: full / partial / write_off. Unlimited lines per match.';
