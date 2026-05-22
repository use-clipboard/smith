-- ============================================================
--  Bookkeeping — VAT returns + late-entry mechanism
-- ============================================================
--  Adds:
--    • bookkeeping_vat_returns       — one row per filed VAT return
--    • books.vat_lock_date           — soft lock auto-set on filing
--    • transactions.vat_period_override — late-entry override date
--
--  Filing model: a VAT return is a snapshot of the 9 boxes for a
--  date range. We do NOT enforce uniqueness on (book_id, from, to)
--  because accountants legitimately file corrections — the history
--  list orders by filed_at desc so the most recent wins.
--
--  Late entries: missed invoices for a filed period can still be
--  posted, but their VAT must be carried into the NEXT return. The
--  vat_period_override column captures that — the VAT calculation
--  uses COALESCE(vat_period_override, date), so the transaction
--  still shows in its real month for P&L / BS purposes.
-- ============================================================

-- 1. The filings table
create table if not exists public.bookkeeping_vat_returns (
  id              uuid primary key default gen_random_uuid(),
  book_id         uuid not null references public.bookkeeping_books(id) on delete cascade,

  -- Sequential VT-style refs: VAT 000001, VAT 000002, … allocated via
  -- bookkeeping_next_ref (with type='VAT'). Lets users say "send me the
  -- backup for VAT 000003" — same shorthand as PAY/SIN/PIN.
  ref_no          text,
  ref_seq         integer,

  period_from     date not null,
  period_to       date not null,

  -- The 9 HMRC VAT-return boxes captured at filing time.
  box1            numeric(14,2) not null,
  box2            numeric(14,2) not null default 0,
  box3            numeric(14,2) not null,
  box4            numeric(14,2) not null,
  box5            numeric(14,2) not null,
  box6            numeric(14,2) not null,
  box7            numeric(14,2) not null,
  box8            numeric(14,2) not null default 0,
  box9            numeric(14,2) not null default 0,

  -- Of-which row — VAT carried forward from earlier locked periods.
  late_entry_vat  numeric(14,2) not null default 0,

  -- Filing metadata. "Filed" = recorded in SMITH; "submitted" = actually sent
  -- to HMRC. They're often the same day, but the SaaS launch will eventually
  -- pull them apart (MTD direct submission). Tracking both now is cheap.
  filed_at        timestamptz not null default now(),
  filed_by        uuid references public.users(id),
  submitted_at    timestamptz,
  submission_method text check (submission_method in ('manual','mtd_api')),
  hmrc_reference  text,
  notes           text,

  -- The closing journal posted at filing time — DR VAT-Output, CR VAT-Input,
  -- net to Net VAT due. Clears the VAT control accounts so the balance sheet
  -- reflects the actual amount owed to / owed by HMRC. NULL on books filed
  -- before this migration landed.
  filing_journal_id uuid references public.bookkeeping_transactions(id) on delete set null,

  -- Full transaction-level breakdown captured at filing time for audit.
  snapshot        jsonb not null default '{}'::jsonb,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  check (period_to >= period_from)
);

create index if not exists bookkeeping_vat_returns_book_idx
  on public.bookkeeping_vat_returns (book_id, period_to desc, filed_at desc);

comment on table public.bookkeeping_vat_returns is
  'One row per filed VAT return. Snapshots the 9-box figures + the full transaction breakdown so the figures survive future edits to underlying transactions.';
comment on column public.bookkeeping_vat_returns.snapshot is
  'jsonb { outputs: [...], inputs: [...], vat_scheme, late_entry_breakdown: [...] } — full audit blob.';

alter table public.bookkeeping_vat_returns enable row level security;

create policy "vat_returns_select_same_firm"
  on public.bookkeeping_vat_returns for select
  using (
    exists (
      select 1 from public.bookkeeping_books b
      where b.id = bookkeeping_vat_returns.book_id
        and b.firm_id = public.my_firm_id()
    )
  );

create policy "vat_returns_modify_same_firm"
  on public.bookkeeping_vat_returns for all
  using (
    exists (
      select 1 from public.bookkeeping_books b
      where b.id = bookkeeping_vat_returns.book_id
        and b.firm_id = public.my_firm_id()
    )
  )
  with check (
    exists (
      select 1 from public.bookkeeping_books b
      where b.id = bookkeeping_vat_returns.book_id
        and b.firm_id = public.my_firm_id()
    )
  );

-- 2. Soft VAT lock on the book — separate from the existing
--    period_lock_date which stays admin-only / year-end.
alter table public.bookkeeping_books
  add column if not exists vat_lock_date date;

comment on column public.bookkeeping_books.vat_lock_date is
  'Soft VAT lock — auto-set to the latest filed VAT return''s period_to. Transactions dated on/before this can still be posted, but must be flagged as late entries (vat_period_override on the transaction).';

-- 3. Late-entry override on individual transactions.
alter table public.bookkeeping_transactions
  add column if not exists vat_period_override date;

create index if not exists bookkeeping_transactions_vat_override_idx
  on public.bookkeeping_transactions (book_id, vat_period_override)
  where vat_period_override is not null;

comment on column public.bookkeeping_transactions.vat_period_override is
  'When set, this date — not transaction.date — slots the transaction into a VAT return. Used for late entries: invoice dated in a previously-filed period that needs to be picked up by the NEXT return. The transaction''s real date stays untouched so P&L/BS remain correct.';

-- 4. Extend the audit entity_type CHECK to allow 'vat_return' rows.
alter table public.bookkeeping_audit
  drop constraint if exists bookkeeping_audit_entity_type_check;
alter table public.bookkeeping_audit
  add constraint bookkeeping_audit_entity_type_check
  check (entity_type in (
    'book','account','transaction','journal',
    'period_lock','permission','coa_template','vat_return'
  ));

-- 5. Allow 'VAT' on the ref counter (so bookkeeping_next_ref can allocate
--    VAT 000001, VAT 000002, … for filed returns the same way it does for
--    transaction types).
alter table public.bookkeeping_ref_counters
  drop constraint if exists bookkeeping_ref_counters_type_check;
alter table public.bookkeeping_ref_counters
  add constraint bookkeeping_ref_counters_type_check
  check (type in ('PAY','CHQ','REC','SIN','SCR','PIN','PCR','JRN','TRF','RJN','VAT'));
