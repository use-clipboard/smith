-- ============================================================
--  Bookkeeping — Year-end close/reopen audit support
-- ============================================================
--  The year-end close/reopen endpoints and the fixed-asset
--  disposal flow write audit rows whose entity_type/action
--  weren't in the original CHECK lists. Extend both so those
--  rows are accepted (previously they silently failed the
--  INSERT and were dropped, leaving no audit trail).
--
--  Additive + idempotent: only widens the allowed sets.
-- ============================================================

-- entity_type: allow 'financial_year' (year-end close/reopen).
alter table public.bookkeeping_audit
  drop constraint if exists bookkeeping_audit_entity_type_check;
alter table public.bookkeeping_audit
  add constraint bookkeeping_audit_entity_type_check
  check (entity_type in (
    'book','account','transaction','journal',
    'period_lock','permission','coa_template','vat_return',
    'financial_year'
  ));

-- action: allow the year-end + disposal verbs.
alter table public.bookkeeping_audit
  drop constraint if exists bookkeeping_audit_action_check;
alter table public.bookkeeping_audit
  add constraint bookkeeping_audit_action_check
  check (action in (
    'create','update','delete','lock','unlock','post','unpost',
    'archive','unarchive',
    'close','reopen','dispose','dispose_reverse'
  ));
