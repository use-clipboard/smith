-- ============================================================
--  Bookkeeping — Bank Rec model rework (period-first)
-- ============================================================
--  Shifts the rec model from "a rec is a CSV upload" to
--  "a rec is a period of cleared splits".
--
--  Key concepts introduced here:
--
--    1. Clearing is independent of statement-line matching.
--       Any ledger split on a bank account can be marked as
--       "cleared in rec N" without needing a paired
--       bookkeeping_bank_lines row. The bank-lines table still
--       exists for richer audit ("this CSV line matched this
--       split"), but is no longer required for a rec to clear
--       items.
--
--    2. One active rec per (account, lifecycle) at a time.
--       A partial unique index prevents the user from starting
--       two pending/in-progress recs on the same bank account
--       — they have to finish or abandon the first.
--
--    3. Opening balance carries forward.  bookkeeping_bank_imports
--       already has opening_balance / closing_balance columns.
--       Their semantics are clarified below:
--         opening_balance = bank-statement opening balance for the
--           rec period.  Pre-filled from the previous reconciled
--           rec's closing_balance + any uncleared b/f items the
--           server can identify; the first rec on a fresh account
--           asks the user to type it.
--         closing_balance = bank-statement closing balance the user
--           is reconciling TOWARD.  Lifted from a CSV/PDF when one
--           is contributed to the rec; otherwise typed by the user.
--           Must be set before the rec can be completed.
-- ============================================================


-- ── Splits: cleared_in_rec_id + cleared_at ──────────────────────────────────
-- The split-level link to a rec.  Nullable because most splits are NOT
-- bank-account postings (every transaction has at least one analysis split
-- that lives in P&L or another balance-sheet ledger, none of which we
-- reconcile against a bank statement).
--
-- ON DELETE SET NULL means deleting a rec un-clears its splits without
-- cascading the deletion through to the underlying transactions — the
-- ledger is the source of truth, the rec is a view over it.
alter table public.bookkeeping_transaction_splits
  add column if not exists cleared_in_rec_id uuid
    references public.bookkeeping_bank_imports(id) on delete set null,
  add column if not exists cleared_at        timestamptz;

-- Index used by the "is this split cleared?" check inside the
-- transactions edit/delete guards, and by the reconcile workspace when
-- listing cleared splits in a rec.
create index if not exists bookkeeping_splits_cleared_rec_idx
  on public.bookkeeping_transaction_splits (cleared_in_rec_id)
  where cleared_in_rec_id is not null;

comment on column public.bookkeeping_transaction_splits.cleared_in_rec_id is
  'When non-null, this split has been ticked off in the named reconciliation. While the rec is in_progress the user can untick; once the rec is reconciled the split is treated as edit-locked at the API layer.';
comment on column public.bookkeeping_transaction_splits.cleared_at is
  'Timestamp the user ticked this split in the rec.  Cleared together with cleared_in_rec_id when un-ticked.';


-- ── One active rec per account ──────────────────────────────────────────────
-- Partial unique index across (account_id) limited to pending/in_progress
-- statuses.  This is the DB belt to the API's braces — the start-a-rec
-- endpoint already checks for an active rec before creating, but if two
-- clients race the index gives us a clean 23505 error to surface.
create unique index if not exists bookkeeping_bank_imports_one_active_per_account
  on public.bookkeeping_bank_imports (account_id)
  where status in ('pending', 'in_progress');


-- ── Clarify opening/closing balance semantics on bank_imports ──────────────
comment on column public.bookkeeping_bank_imports.opening_balance is
  'Bank-statement opening balance at period_start. Pre-filled by the server from the previous reconciled rec''s closing_balance; user-editable on first rec for a fresh account. Used together with closing_balance + cleared splits in-period to compute the rec gap.';
comment on column public.bookkeeping_bank_imports.closing_balance is
  'Bank-statement closing balance at period_end — the figure the user is reconciling TOWARD. Lifted from a CSV/PDF when one is contributed to the rec, otherwise typed by the user. Must be set before status can move to reconciled.';


-- ── Per-rec audit columns ──────────────────────────────────────────────────
-- Two new optional columns used by the period-first workspace:
--   • completed_by / completed_at  — separate from reconciled_by/at so we
--     can record "user X clicked Reconcile period at time T" even when the
--     rec is later reopened.  reconciled_at gets nulled on reopen; this
--     pair stays as a historical record visible in the History tab.
--   • notes  — free-text rec-level note ("Balanced with the £45 standing
--     order we hadn't posted, see PAY 000456").
alter table public.bookkeeping_bank_imports
  add column if not exists completed_by uuid references public.users(id) on delete set null,
  add column if not exists completed_at timestamptz,
  add column if not exists notes        text;


-- ── Backfill: existing bank_lines.matched_split_id → cleared_in_rec_id ─────
-- Any split that's already matched to a statement line under the old model
-- should be treated as cleared in that same rec going forward.  Single
-- UPDATE driven by a join — RLS doesn't apply to migrations.
update public.bookkeeping_transaction_splits s
   set cleared_in_rec_id = l.import_id,
       cleared_at        = coalesce(l.reconciled_at, l.created_at)
  from public.bookkeeping_bank_lines l
 where l.matched_split_id = s.id
   and s.cleared_in_rec_id is null;
