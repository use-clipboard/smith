-- Add the 'completed' triage category (a terminal "all follow-up done" bucket).
-- The original CHECK constraint didn't include it, so widen it.

alter table email_triage_categories
  drop constraint if exists email_triage_categories_category_check;

alter table email_triage_categories
  add constraint email_triage_categories_category_check
  check (category in ('untriaged','needs_reply','fyi','waiting_client','documents','completed'));
