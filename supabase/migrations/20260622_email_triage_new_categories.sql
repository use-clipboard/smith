-- Widen the triage category CHECK constraint to the full current taxonomy:
-- adds 'to_do' and 'internal' (new buckets) and ensures 'completed' (shown as
-- "No Action Needed") is allowed — the earlier widening migration may not have
-- been applied on all environments.
alter table email_triage_categories
  drop constraint if exists email_triage_categories_category_check;

alter table email_triage_categories
  add constraint email_triage_categories_category_check
  check (category in ('untriaged','needs_reply','to_do','waiting_client','documents','internal','fyi','completed'));
