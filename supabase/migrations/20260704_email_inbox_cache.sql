-- Email inbox cache: a server-side mirror of which Gmail messages are currently
-- in each user's inbox, so the "untriaged" count can be computed from the
-- database instead of re-listing the entire inbox from Gmail on every call
-- (that enumeration is up to 25 sequential Gmail requests and is the slow part).
--
-- Kept fresh incrementally via the Gmail history API — email_connections.history_id
-- is the "bookmark", and inbox_synced_at records the last full reconciliation.
-- Rebuilt with a single full scan when the bookmark is missing or has expired.
--
-- One row per (user, message) currently in the inbox. Service-role only,
-- matching email_message_triage (RLS on, no policies).

create table if not exists email_inbox_cache (
  user_id    uuid not null references users(id) on delete cascade,
  message_id text not null,        -- gmail message id
  thread_id  text,                 -- gmail thread id (carried for convenience)
  primary key (user_id, message_id)
);

create index if not exists idx_email_inbox_cache_user on email_inbox_cache (user_id);

alter table email_inbox_cache enable row level security;
-- No policies: this table is only ever touched by the service role.

-- When the inbox cache was last fully reconciled — drives the drift safety-net.
alter table email_connections add column if not exists inbox_synced_at timestamptz;

-- Fast untriaged count: inbox-cache rows that have NO non-"untriaged" triage row
-- for this user (no row at all, or a row still marked 'untriaged', both count).
-- Mirrors the previous in-Node logic, but as a single indexed query.
create or replace function email_untriaged_count(p_user_id uuid)
returns integer
language sql
stable
as $$
  select count(*)::int
  from email_inbox_cache c
  where c.user_id = p_user_id
    and not exists (
      select 1
      from email_message_triage t
      where t.user_id = p_user_id
        and t.message_id = c.message_id
        and t.category <> 'untriaged'
    );
$$;
