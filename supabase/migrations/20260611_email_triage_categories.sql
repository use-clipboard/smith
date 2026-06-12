-- Email triage categories — persists the AI / manual triage bucket per thread
-- so categories survive reloads and are shared across the firm. One row per
-- (firm, gmail thread). Accessed only via the service client in
-- /api/email/triage-categories (RLS on, no policies → service-role only).

create table if not exists email_triage_categories (
  id         uuid primary key default gen_random_uuid(),
  firm_id    uuid not null references firms(id) on delete cascade,
  thread_id  text not null,                     -- gmail thread id
  category   text not null check (category in ('untriaged','needs_reply','fyi','waiting_client','documents')),
  set_by     text not null default 'ai' check (set_by in ('ai','user')),
  updated_at timestamptz not null default now(),
  unique (firm_id, thread_id)
);

create index if not exists idx_email_triage_categories_firm on email_triage_categories (firm_id);

alter table email_triage_categories enable row level security;
