-- Customisable email triage categories (per user).
--
-- Each user can rename / recolour / re-icon / reorder the middle triage
-- categories (the two anchors — 'untriaged' first and 'completed'/"No Action
-- Needed" last — stay fixed). Their ordered set of MIDDLE categories is stored
-- as JSON on the user row; absent = the built-in defaults. Categories are still
-- recorded on emails by their stable `key` in email_message_triage.

alter table public.users
  add column if not exists email_triage_categories jsonb;

-- The category column used to be constrained to a fixed enum, which blocks any
-- custom key. Drop that CHECK — values are now validated per-user in the API
-- against each user's own category config.
alter table public.email_message_triage
  drop constraint if exists email_message_triage_category_check;
