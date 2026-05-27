-- ============================================================
--  Bookkeeping — Bank Statement Import & Reconciliation
-- ============================================================
--  Adds the two tables that drive the per-bank-account
--  reconciliation flow:
--
--    • bookkeeping_bank_imports — one row per uploaded statement
--    • bookkeeping_bank_lines   — parsed statement lines, each
--      optionally linked to a transaction split via
--      `matched_split_id`. A reconciled line locks its split's
--      transaction from edits (enforced at the API layer).
--
--  Existing `bookkeeping_matches` / `bookkeeping_match_lines`
--  remain the right place for CR↔DR allocation within the
--  Customers/Suppliers ledgers. Bank rec is intentionally a
--  lighter, statement-line-to-split link so the audit story
--  ("the statement says X, the ledger says Y") stays simple.
-- ============================================================

-- ── bookkeeping_bank_imports ────────────────────────────────────────────────
create table if not exists public.bookkeeping_bank_imports (
  id                  uuid primary key default gen_random_uuid(),
  book_id             uuid not null references public.bookkeeping_books(id) on delete cascade,
  /** The bank/cash account this statement belongs to. Bank Rec is always
      per-account: a "Current account" import never reconciles against
      "Petty cash". */
  account_id          uuid not null references public.bookkeeping_accounts(id) on delete cascade,

  file_name           text not null,
  /** Free-text label for the user — "Apr 2026 statement", "Q1 download" etc. */
  display_label       text,

  /** Statement period — derived from the lines on parse, used for sanity
      checks ("are all your dates in range?") and the rec balance display. */
  period_start        date,
  period_end          date,

  /** Opening / closing balances as stated by the bank. Optional — many CSVs
      don't include them. When present the rec screen shows the gap
      between statement and ledger as you tick lines off. */
  opening_balance     numeric(14,2),
  closing_balance     numeric(14,2),

  /** Lifecycle:
        pending      — uploaded, no lines reconciled yet
        in_progress  — at least one line reconciled, not yet complete
        reconciled   — every line reconciled OR explicitly marked complete
        abandoned    — user cancelled; lines kept for audit but not active */
  status              text not null default 'pending'
                      check (status in ('pending','in_progress','reconciled','abandoned')),

  uploaded_by         uuid references public.users(id) on delete set null,
  uploaded_at         timestamptz not null default now(),
  reconciled_at       timestamptz,
  reconciled_by       uuid references public.users(id) on delete set null
);

create index if not exists bookkeeping_bank_imports_account_idx
  on public.bookkeeping_bank_imports (account_id, uploaded_at desc);

create index if not exists bookkeeping_bank_imports_book_idx
  on public.bookkeeping_bank_imports (book_id, status);

comment on table public.bookkeeping_bank_imports is
  'Bank statement uploads — one row per CSV/OFX/PDF the user has imported for a specific bank account.';


-- ── bookkeeping_bank_lines ──────────────────────────────────────────────────
create table if not exists public.bookkeeping_bank_lines (
  id                  uuid primary key default gen_random_uuid(),
  import_id           uuid not null references public.bookkeeping_bank_imports(id) on delete cascade,
  /** Denormalised so RLS doesn't have to traverse the import → book join on
      every read. Kept in sync via the parse step (server-side). */
  book_id             uuid not null references public.bookkeeping_books(id) on delete cascade,
  account_id          uuid not null references public.bookkeeping_accounts(id) on delete cascade,

  /** Row order within the imported file. Lets the UI list lines as the user
      first saw them in their statement, not by date alone (some CSVs put
      pending items at the top etc.). */
  line_no             int not null,

  date                date not null,
  description         text not null default '',

  /** Signed money-in convention:
        positive  = money INTO the bank account (debit to bank, credit to source)
        negative  = money OUT of the bank account (credit to bank, debit to expense/supplier)
      Two-column "Money in / Money out" CSVs are normalised to this signed
      form at parse time. */
  amount              numeric(14,2) not null,

  /** Optional running balance as printed on the statement. Helps spot
      out-of-order or missing lines; not used for matching. */
  statement_balance   numeric(14,2),

  /** Linked split when reconciled. NULL = still open. A UNIQUE partial
      index below guarantees a split can only be linked to one statement
      line — you can't reconcile the same posting twice. */
  matched_split_id    uuid references public.bookkeeping_transaction_splits(id) on delete set null,
  reconciled_at       timestamptz,
  reconciled_by       uuid references public.users(id) on delete set null,

  /** Free-text note the user can attach during the rec (e.g. "OK — DD
      from supplier, posted PAY 000123"). */
  notes               text,

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- A split can only ever match one statement line. Partial index so multiple
-- un-matched (NULL) lines don't violate the constraint.
create unique index if not exists bookkeeping_bank_lines_matched_split_uidx
  on public.bookkeeping_bank_lines (matched_split_id)
  where matched_split_id is not null;

create index if not exists bookkeeping_bank_lines_import_idx
  on public.bookkeeping_bank_lines (import_id, line_no);

create index if not exists bookkeeping_bank_lines_account_open_idx
  on public.bookkeeping_bank_lines (account_id, date)
  where matched_split_id is null;

comment on table public.bookkeeping_bank_lines is
  'Parsed bank statement lines. matched_split_id links a line to the ledger split that satisfies it; once set the underlying transaction is treated as reconciled and locked from edits at the API layer.';


-- ── RLS ─────────────────────────────────────────────────────────────────────
-- Same firm-scoped policy pattern as bookkeeping_vat_returns / matches.
alter table public.bookkeeping_bank_imports enable row level security;
alter table public.bookkeeping_bank_lines   enable row level security;

create policy "bank_imports_select_same_firm"
  on public.bookkeeping_bank_imports for select
  using (
    exists (
      select 1 from public.bookkeeping_books b
      where b.id = bookkeeping_bank_imports.book_id
        and b.firm_id = public.my_firm_id()
    )
  );

create policy "bank_imports_modify_same_firm"
  on public.bookkeeping_bank_imports for all
  using (
    exists (
      select 1 from public.bookkeeping_books b
      where b.id = bookkeeping_bank_imports.book_id
        and b.firm_id = public.my_firm_id()
    )
  )
  with check (
    exists (
      select 1 from public.bookkeeping_books b
      where b.id = bookkeeping_bank_imports.book_id
        and b.firm_id = public.my_firm_id()
    )
  );

create policy "bank_lines_select_same_firm"
  on public.bookkeeping_bank_lines for select
  using (
    exists (
      select 1 from public.bookkeeping_books b
      where b.id = bookkeeping_bank_lines.book_id
        and b.firm_id = public.my_firm_id()
    )
  );

create policy "bank_lines_modify_same_firm"
  on public.bookkeeping_bank_lines for all
  using (
    exists (
      select 1 from public.bookkeeping_books b
      where b.id = bookkeeping_bank_lines.book_id
        and b.firm_id = public.my_firm_id()
    )
  )
  with check (
    exists (
      select 1 from public.bookkeeping_books b
      where b.id = bookkeeping_bank_lines.book_id
        and b.firm_id = public.my_firm_id()
    )
  );

-- ── Realtime — opt-in (best-effort, ignore if already added) ───────────────
do $$
begin
  alter publication supabase_realtime add table public.bookkeeping_bank_imports;
exception
  when others then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.bookkeeping_bank_lines;
exception
  when others then null;
end $$;
