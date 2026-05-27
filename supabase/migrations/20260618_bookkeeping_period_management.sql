-- ============================================================
--  Bookkeeping — Period management (Phase 5)
-- ============================================================
--  Foundations for proper financial-year handling:
--
--    • bookkeeping_books gains a year_end pattern, a first-period
--      anchor and a pointer to the Retained earnings account that
--      P&L closes into at year-end.
--    • New table `bookkeeping_financial_years` — one row per FY
--      with status (open/closed/reopened), audit columns, and a
--      link to the closing journal transaction.
--
--  Locking rules (enforced at the API layer, not in SQL):
--    • status='closed' year → no edits to transactions dated in it
--      except via an admin-flagged adjusting JRN.
--    • period_lock_date → soft lock for partial-year work; still
--      respected as today.
--    • vat_lock_date → derived from filed VAT returns; unchanged.
-- ============================================================

-- ── bookkeeping_books: new columns ─────────────────────────────────────────
alter table public.bookkeeping_books
  add column if not exists year_end_md text;
-- MM-DD, e.g. '03-31' for a 31-March year-end. Stored as text so we don't
-- have to invent a real date — the year part is irrelevant.

alter table public.bookkeeping_books
  add column if not exists first_period_start date;
-- The very first date the book's accounts cover. Used as the start of the
-- earliest financial year. Auto-set to the earliest transaction date when
-- the user first sets a year-end pattern.

alter table public.bookkeeping_books
  add column if not exists retained_earnings_account_id uuid
    references public.bookkeeping_accounts(id) on delete set null;
-- The Equity account that P&L is closed into at year-end. We don't pick a
-- default during the migration — the seed COA's "Profit and loss account"
-- (Equity ledger) is the natural fit and the close endpoint will warn if
-- this is null.

comment on column public.bookkeeping_books.year_end_md is
  'MM-DD pattern for the financial year-end (e.g. ''03-31''). Year-agnostic — the FY rows in bookkeeping_financial_years drive the actual dates.';
comment on column public.bookkeeping_books.first_period_start is
  'Start date of the earliest financial year on this book. Set by the API when the user first sets a year-end (defaults to the earliest existing transaction date).';
comment on column public.bookkeeping_books.retained_earnings_account_id is
  'Equity account that P&L net is closed into at year-end. The close endpoint refuses to run when this is null.';


-- ── bookkeeping_financial_years ────────────────────────────────────────────
create table if not exists public.bookkeeping_financial_years (
  id              uuid primary key default gen_random_uuid(),
  book_id         uuid not null references public.bookkeeping_books(id) on delete cascade,

  /** Inclusive boundaries. start_date is always the day after the previous
      FY's end_date (or first_period_start for the very first FY). */
  start_date      date not null,
  end_date        date not null,

  status          text not null default 'open'
                  check (status in ('open', 'closed', 'reopened')),

  /** When status='closed', who/when and which journal effected the close.
      The journal zeroes every P&L account into the Retained earnings
      account and is dated end_date. */
  closed_at       timestamptz,
  closed_by       uuid references public.users(id) on delete set null,
  closing_journal_id uuid references public.bookkeeping_transactions(id) on delete set null,

  /** When status='reopened', admin audit of the un-closure. */
  reopened_at     timestamptz,
  reopened_by     uuid references public.users(id) on delete set null,
  reopen_reason   text,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  /** A book can only have one FY starting on any given date — guards
      against overlapping years from concurrent year-end edits. */
  unique (book_id, start_date)
);

create index if not exists bookkeeping_financial_years_book_idx
  on public.bookkeeping_financial_years (book_id, start_date);

comment on table public.bookkeeping_financial_years is
  'Per-book financial years. One row per FY, in chronological order. status drives the lock model: open = editable, closed = no edits without admin reopen, reopened = was closed then reopened (still editable, retained audit).';


-- ── RLS ────────────────────────────────────────────────────────────────────
alter table public.bookkeeping_financial_years enable row level security;

create policy "financial_years_select_same_firm"
  on public.bookkeeping_financial_years for select
  using (
    exists (
      select 1 from public.bookkeeping_books b
      where b.id = bookkeeping_financial_years.book_id
        and b.firm_id = public.my_firm_id()
    )
  );

create policy "financial_years_modify_same_firm"
  on public.bookkeeping_financial_years for all
  using (
    exists (
      select 1 from public.bookkeeping_books b
      where b.id = bookkeeping_financial_years.book_id
        and b.firm_id = public.my_firm_id()
    )
  )
  with check (
    exists (
      select 1 from public.bookkeeping_books b
      where b.id = bookkeeping_financial_years.book_id
        and b.firm_id = public.my_firm_id()
    )
  );


-- ── Realtime ───────────────────────────────────────────────────────────────
do $$
begin
  alter publication supabase_realtime add table public.bookkeeping_financial_years;
exception
  when others then null;
end $$;
