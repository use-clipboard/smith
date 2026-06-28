-- Bookkeeping — recurring (memorised / standing) transactions.
--
-- A saved transaction template + a schedule. When an occurrence is due the user
-- posts it with one click and the next due date advances. The template stores
-- the full header + splits (incl. fund_id) as jsonb so it materialises into a
-- normal transaction via the same posting path.
--
-- Posting is deliberately manual (review-then-post) — financial entries
-- shouldn't appear unreviewed. A "due" count surfaces what's ready.

create table if not exists public.bookkeeping_recurring_transactions (
  id             uuid primary key default gen_random_uuid(),
  book_id        uuid not null references public.bookkeeping_books(id) on delete cascade,
  name           text not null,                       -- e.g. "Monthly office rent"
  type           text not null,                       -- transaction type (PAY/REC/JRN/...)
  frequency      text not null check (frequency in ('weekly', 'monthly', 'quarterly', 'yearly')),
  interval_count int  not null default 1 check (interval_count >= 1),  -- every N periods
  next_due_date  date not null,
  end_date       date,                                -- stop after this date (null = open-ended)
  last_run_date  date,                                -- when an occurrence was last posted
  active         boolean not null default true,
  -- { payee_text, details, total, vat_total, vat_rate, vat_treatment,
  --   primary_account_id, splits: [{ account_id, debit, credit, entry_details, notes, fund_id }] }
  template       jsonb not null,
  created_by     uuid references public.users(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists bookkeeping_recurring_book_idx
  on public.bookkeeping_recurring_transactions (book_id, active, next_due_date);

comment on table public.bookkeeping_recurring_transactions is
  'Recurring/memorised transactions: a saved transaction template (jsonb header+splits) plus a schedule. Materialises into a normal transaction when the user posts a due occurrence.';

alter table public.bookkeeping_recurring_transactions enable row level security;

drop policy if exists "recurring: same firm via book" on public.bookkeeping_recurring_transactions;
create policy "recurring: same firm via book"
  on public.bookkeeping_recurring_transactions for all
  using (exists (
    select 1 from public.bookkeeping_books b
    where b.id = bookkeeping_recurring_transactions.book_id
      and b.firm_id = public.my_firm_id()
  ))
  with check (exists (
    select 1 from public.bookkeeping_books b
    where b.id = bookkeeping_recurring_transactions.book_id
      and b.firm_id = public.my_firm_id()
  ));
