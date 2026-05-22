-- ============================================================
--  Bookkeeping — Reversing Journals (RJN)
-- ============================================================
--  Adds the RJN transaction type and a link column so a reversing
--  journal and its auto-reversal entry are paired in the database.
--
--  A RJN works like this:
--    • The user posts an entry dated X with a "reverses on" date Y.
--    • SMITH creates TWO transactions:
--        - The original at date X
--        - The reverse at date Y, with debits and credits swapped
--    • Both share type='RJN'; the reverse points at the original via
--      reverses_transaction_id.
--
--  Used for accruals, prepayments, and any other timing journal that
--  has to self-cancel in a future period.
-- ============================================================

-- 1. Allow 'RJN' on every type CHECK constraint that lists transaction types.
alter table public.bookkeeping_transactions
  drop constraint if exists bookkeeping_transactions_type_check;
alter table public.bookkeeping_transactions
  add constraint bookkeeping_transactions_type_check
  check (type in ('PAY','CHQ','REC','SIN','SCR','PIN','PCR','JRN','TRF','RJN'));

alter table public.bookkeeping_ref_counters
  drop constraint if exists bookkeeping_ref_counters_type_check;
alter table public.bookkeeping_ref_counters
  add constraint bookkeeping_ref_counters_type_check
  check (type in ('PAY','CHQ','REC','SIN','SCR','PIN','PCR','JRN','TRF','RJN'));

alter table public.bookkeeping_payee_memory
  drop constraint if exists bookkeeping_payee_memory_transaction_type_check;
alter table public.bookkeeping_payee_memory
  add constraint bookkeeping_payee_memory_transaction_type_check
  check (transaction_type in ('PAY','CHQ','REC','SIN','SCR','PIN','PCR','JRN','TRF','RJN'));

-- 2. Reversal-pair link. The reverse transaction points at the original.
alter table public.bookkeeping_transactions
  add column if not exists reverses_transaction_id uuid
    references public.bookkeeping_transactions(id) on delete set null;

create index if not exists bookkeeping_transactions_reverses_idx
  on public.bookkeeping_transactions (reverses_transaction_id)
  where reverses_transaction_id is not null;

comment on column public.bookkeeping_transactions.reverses_transaction_id is
  'For RJN reversal entries: points back at the original RJN being reversed. NULL for any other transaction.';
