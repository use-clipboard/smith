-- ============================================================
--  Bookkeeping — DVT type, transaction notes, bulk-import staging
-- ============================================================
--  Three things in one migration because they all land together
--  with the VT → SMITH bulk importer:
--
--    1) DVT (Deferred VAT Transfer) — VT's transaction type for
--       moving VAT-on-imports between control accounts when goods
--       clear customs. Posted journal-style (multi-leg, balances).
--       Added on its own ref sequence so DVT 0000xx stays distinct.
--
--    2) transactions.notes — separate field from `details`. Details
--       is the single-line subject ("Amazon — Office stationery").
--       Notes is the long-form free-form text VT exports use to
--       record investigation paragraphs ("the payment for rent a
--       car was made in October — see bank statement…"). Both
--       fields are imported from the VT transaction report (Details
--       = col E, Notes = col A multi-row text under the txn).
--
--    3) bookkeeping_imports staging table + transactions.import_id —
--       the bulk importer creates one bookkeeping_imports row per
--       upload and tags every inserted transaction with that id.
--       That tag is the ONLY thing rollback needs: delete every
--       transaction with import_id = X, then delete the import row.
--       The staging table also keeps the original parsed summary
--       (row counts, type breakdown, errors) so the import history
--       UI can show what happened without re-parsing.
-- ============================================================

-- 1) DVT type ---------------------------------------------------
alter table public.bookkeeping_transactions
  drop constraint if exists bookkeeping_transactions_type_check;
alter table public.bookkeeping_transactions
  add constraint bookkeeping_transactions_type_check
  check (type in ('PAY','CHQ','REC','SIN','SCR','PIN','PCR','JRN','TRF','RJN','WOF','WBK','YET','DVT'));

alter table public.bookkeeping_ref_counters
  drop constraint if exists bookkeeping_ref_counters_type_check;
alter table public.bookkeeping_ref_counters
  add constraint bookkeeping_ref_counters_type_check
  check (type in ('PAY','CHQ','REC','SIN','SCR','PIN','PCR','JRN','TRF','RJN','WOF','WBK','YET','DVT'));

alter table public.bookkeeping_payee_memory
  drop constraint if exists bookkeeping_payee_memory_transaction_type_check;
alter table public.bookkeeping_payee_memory
  add constraint bookkeeping_payee_memory_transaction_type_check
  check (transaction_type in ('PAY','CHQ','REC','SIN','SCR','PIN','PCR','JRN','TRF','RJN','WOF','WBK','YET','DVT'));

-- 2) Notes field on transactions -------------------------------
alter table public.bookkeeping_transactions
  add column if not exists notes text;

comment on column public.bookkeeping_transactions.notes is
  'Long-form free-text notes attached to the transaction. Distinct from `details` (single-line subject). Imported from the VT transaction report — VT puts multi-line investigation notes in column A under the transaction. Surfaced in the ledger view via a 📝 icon click-to-expand.';

-- 3) Bulk-import staging ---------------------------------------
create table if not exists public.bookkeeping_imports (
  id            uuid primary key default gen_random_uuid(),
  book_id       uuid not null references public.bookkeeping_books on delete cascade,
  uploaded_by   uuid references public.users on delete set null,
  file_name     text not null,
  -- 'pending'      — uploaded + parsed, awaiting Post
  -- 'posting'      — actively posting (server is mid-batch)
  -- 'posted'       — all transactions inserted successfully
  -- 'errored'      — parsing or posting failed; nothing committed
  -- 'rolled_back'  — user clicked rollback; transactions deleted
  status        text not null default 'pending'
                check (status in ('pending','posting','posted','errored','rolled_back')),
  -- Summary populated during parsing: { rows, transactions, types: {PAY: n, ...},
  -- date_range: {from, to}, coa: {existing: n, to_create: n}, errors: [...] }
  summary       jsonb,
  -- Cached parsed rows for the "preview before post" step. Cleared after
  -- successful Post (no need to retain — the live transactions are the truth).
  parsed_rows   jsonb,
  created_at    timestamptz not null default now(),
  posted_at     timestamptz,
  rolled_back_at timestamptz
);

create index if not exists bookkeeping_imports_book_idx
  on public.bookkeeping_imports (book_id, created_at desc);

alter table public.bookkeeping_imports enable row level security;

-- Same-firm-via-book access pattern as everything else in the module.
create policy "imports: same firm via book"
  on public.bookkeeping_imports for all
  using (exists (
    select 1 from public.bookkeeping_books b
    where b.id = bookkeeping_imports.book_id
      and b.firm_id = public.my_firm_id()
  ))
  with check (exists (
    select 1 from public.bookkeeping_books b
    where b.id = bookkeeping_imports.book_id
      and b.firm_id = public.my_firm_id()
  ));

comment on table public.bookkeeping_imports is
  'One row per bulk-import upload (VT → SMITH). Tags every transaction it inserted via transactions.import_id so rollback is a single DELETE.';

-- 4) Link transactions back to the import that created them -----
alter table public.bookkeeping_transactions
  add column if not exists import_id uuid
    references public.bookkeeping_imports(id) on delete set null;

create index if not exists bookkeeping_transactions_import_idx
  on public.bookkeeping_transactions (import_id)
  where import_id is not null;

comment on column public.bookkeeping_transactions.import_id is
  'When non-NULL, this transaction came from a bulk import. The Rollback button on the imports list does DELETE FROM bookkeeping_transactions WHERE import_id = X.';
