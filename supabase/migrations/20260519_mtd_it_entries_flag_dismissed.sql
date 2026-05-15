-- MTD IT — persist the user's "I've reviewed this and it's fine" decision.
--
-- The review editor lets the user clear an auto-applied flag (out-of-range
-- date, possible duplicate, manually flagged). Previously that dismissal
-- lived in client memory only, so after Save + reload the editor's
-- applyAutoFlags() would happily re-flag the same row.
--
-- This column captures the dismissal alongside the row so it sticks.

alter table public.mtd_it_entries
  add column if not exists flag_dismissed boolean not null default false;
