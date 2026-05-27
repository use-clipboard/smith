-- ============================================================
--  Bookkeeping — Write Offs (WOF), Write Backs (WBK), Year-End
--  Transactions (YET)
-- ============================================================
--  Three new VT-style transaction types so SMITH can hold parity
--  with the source ledgers we're importing from VT:
--
--    WOF — Write off. Two-leg posting:
--            Dr  Analysis  (typically "Write offs/discounts" expense)
--            Cr  Primary   (the supplier/debtor being cleared)
--          Used to close small residual balances on AR/AP accounts.
--
--    WBK — Write back. Inverse of WOF:
--            Dr  Primary   (the supplier/debtor being re-instated)
--            Cr  Analysis  (typically "Write offs/discounts" expense)
--          Used when a previously-written-off balance turns out to be
--          collectable / payable again.
--
--    YET — Year-end transaction. Multi-leg journal-style entry posted
--          on the FY end date. Typically the closing entries that move
--          P&L balances into Retained Earnings, plus year-end accruals.
--          Modelled like JRN — the input sheet is a Dr/Cr grid rather
--          than primary+analysis. Each YET gets its own ref sequence
--          so year-end work is easy to find in the audit trail.
--
--  As with RJN before it, we extend every type CHECK constraint that
--  enumerates transaction types. Migration is idempotent.
-- ============================================================

-- 1. Allow new types on every type CHECK constraint.
alter table public.bookkeeping_transactions
  drop constraint if exists bookkeeping_transactions_type_check;
alter table public.bookkeeping_transactions
  add constraint bookkeeping_transactions_type_check
  check (type in ('PAY','CHQ','REC','SIN','SCR','PIN','PCR','JRN','TRF','RJN','WOF','WBK','YET'));

alter table public.bookkeeping_ref_counters
  drop constraint if exists bookkeeping_ref_counters_type_check;
alter table public.bookkeeping_ref_counters
  add constraint bookkeeping_ref_counters_type_check
  check (type in ('PAY','CHQ','REC','SIN','SCR','PIN','PCR','JRN','TRF','RJN','WOF','WBK','YET'));

alter table public.bookkeeping_payee_memory
  drop constraint if exists bookkeeping_payee_memory_transaction_type_check;
alter table public.bookkeeping_payee_memory
  add constraint bookkeeping_payee_memory_transaction_type_check
  check (transaction_type in ('PAY','CHQ','REC','SIN','SCR','PIN','PCR','JRN','TRF','RJN','WOF','WBK','YET'));
