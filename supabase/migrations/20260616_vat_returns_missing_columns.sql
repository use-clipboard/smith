-- ============================================================
--  Fix schema drift on bookkeeping_vat_returns
-- ============================================================
--  The live DB was missing five filing-metadata columns that the
--  app's code selects/inserts. Without them:
--    • GET /vat-returns errors (selects ref_no, …) → filings list
--      always appears empty.
--    • Recording a filing (manual "Mark as filed" OR MTD submit)
--      fails on insert → nothing is ever saved.
--
--  Idempotent — safe to run on any environment.
-- ============================================================

alter table public.bookkeeping_vat_returns
  add column if not exists ref_no            text,
  add column if not exists ref_seq           integer,
  add column if not exists submitted_at      timestamptz,
  add column if not exists submission_method text,
  add column if not exists filing_journal_id uuid
    references public.bookkeeping_transactions(id) on delete set null;

-- submission_method allowed values (guard against re-adding).
do $$ begin
  alter table public.bookkeeping_vat_returns
    add constraint bookkeeping_vat_returns_submission_method_check
    check (submission_method in ('manual', 'mtd_api'));
exception when duplicate_object then null; end $$;

-- Same drift on the ref counter: 'VAT' (and the full transaction-type set) must
-- be allowed so filing can allocate a VAT 000001-style reference.
alter table public.bookkeeping_ref_counters
  drop constraint if exists bookkeeping_ref_counters_type_check;
alter table public.bookkeeping_ref_counters
  add constraint bookkeeping_ref_counters_type_check
  check (type in (
    'PAY','CHQ','REC','SIN','SCR','PIN','PCR','JRN','RJN','TRF','WOF','WBK','YET','DVT','VAT'
  ));
