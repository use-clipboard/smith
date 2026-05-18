-- Email allocations — track per-message, not per-thread
--
-- Previously the (thread_id, client_id, firm_id) unique constraint meant that
-- once a thread was allocated to a client, any subsequent allocation call on
-- the same thread (e.g. when sending a reply or allocating a new inbound
-- message) was deduped — leaving the client timeline with only the first
-- message in the thread. That swallowed the rest of the back-and-forth.
--
-- New shape: allocation is per (thread_id, client_id, message_id). Each
-- distinct message in a thread gets its own row + its own timeline note, so
-- the full conversation lands on the client timeline. The pre-fill logic in
-- compose (which still asks "is this thread allocated to this client?")
-- continues to work because it only checks for any matching thread+client
-- row regardless of message_id.

alter table public.email_allocations
  add column if not exists message_id text;

-- Drop the old thread-level unique constraint if present (under either of
-- the names it has carried in different migration generations).
alter table public.email_allocations
  drop constraint if exists email_allocations_thread_id_client_id_firm_id_key;
alter table public.email_allocations
  drop constraint if exists email_allocations_firm_id_thread_id_client_id_key;

-- Drop any matching unique index too (constraint names + index names can
-- diverge in older databases).
drop index if exists email_allocations_firm_thread_client_idx;
drop index if exists email_allocations_thread_client_firm_idx;

-- New uniqueness: per message. Legacy rows where message_id is null are
-- still uniquely identified by (firm_id, thread_id, client_id) thanks to
-- Postgres treating NULLs as distinct by default, so they coexist with
-- new per-message rows.
alter table public.email_allocations
  add constraint email_allocations_firm_thread_client_message_key
  unique (firm_id, thread_id, client_id, message_id);

-- Index to support the per-message dedupe lookup in /api/email/allocate.
create index if not exists email_allocations_lookup_idx
  on public.email_allocations (firm_id, thread_id, client_id, message_id);
