-- Per-user, per-email triage (replaces the firm-wide, per-thread model).
--
-- Every individual email (Gmail message) is triaged independently by each
-- user: an email that means nothing to one person can be important to
-- another, and emails within the same conversation may need different
-- treatment. One row per (user, message); no row = untriaged for that user.
--
-- thread_id is carried for the threaded-view filter only. The old
-- email_triage_categories table is left in place but is no longer read.
create table if not exists email_message_triage (
  id         uuid primary key default gen_random_uuid(),
  firm_id    uuid not null references firms(id) on delete cascade,
  user_id    uuid not null references users(id) on delete cascade,
  message_id text not null,   -- gmail message id (one row per email)
  thread_id  text,            -- gmail thread id (threaded-view filtering)
  category   text not null check (category in ('untriaged','needs_reply','to_do','waiting_client','documents','internal','fyi','completed')),
  set_by     text not null default 'ai' check (set_by in ('ai','user')),
  updated_at timestamptz not null default now(),
  unique (user_id, message_id)
);

create index if not exists idx_email_message_triage_user_cat on email_message_triage (user_id, category);
create index if not exists idx_email_message_triage_user_thread on email_message_triage (user_id, thread_id);

-- Service-role only, matching the old table (RLS on, no policies).
alter table email_message_triage enable row level security;
