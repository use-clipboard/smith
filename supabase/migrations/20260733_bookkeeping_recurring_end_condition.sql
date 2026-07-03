-- Bookkeeping — recurring transactions: "ends after N occurrences" support.
--
-- The schedule already supported "ends on a date" (end_date) and "never ends"
-- (both null). This adds the third end condition the UI now offers: stop after
-- a fixed number of posted occurrences.
--
--   max_occurrences     — target count (null = no count limit)
--   occurrences_posted  — how many occurrences have actually been posted so far
--
-- The run endpoint increments occurrences_posted on each post and deactivates
-- the schedule once the target is reached; isDue() also treats a reached target
-- as "no longer due".

alter table public.bookkeeping_recurring_transactions
  add column if not exists max_occurrences    int,
  add column if not exists occurrences_posted int not null default 0;

alter table public.bookkeeping_recurring_transactions
  drop constraint if exists bookkeeping_recurring_max_occurrences_positive;
alter table public.bookkeeping_recurring_transactions
  add constraint bookkeeping_recurring_max_occurrences_positive
  check (max_occurrences is null or max_occurrences >= 1);

comment on column public.bookkeeping_recurring_transactions.max_occurrences is
  'Stop after this many posted occurrences (null = no count limit). Paired with occurrences_posted.';
comment on column public.bookkeeping_recurring_transactions.occurrences_posted is
  'Number of occurrences posted so far. Incremented by the run endpoint; when it reaches max_occurrences the schedule is deactivated.';
