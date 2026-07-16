-- Billing module — client statements.
--
-- Two things: firm-level settings for what a statement shows and when it runs,
-- and a log of statements actually sent. The log is what makes the scheduled run
-- idempotent — a cron that fires twice in a day must not email a client twice.

-- ── Settings ────────────────────────────────────────────────────────────────
alter table public.billing_settings
  -- 'outstanding' = open items only (unpaid invoices).
  -- 'activity'    = all invoices and payments over the period, with a balance.
  add column if not exists statement_mode text not null default 'outstanding'
    check (statement_mode in ('outstanding', 'activity')),
  -- How far back an activity statement looks. Ignored when mode = 'outstanding'.
  add column if not exists statement_period_months int not null default 3
    check (statement_period_months between 1 and 24),
  add column if not exists statement_auto_enabled boolean not null default false,
  add column if not exists statement_frequency text not null default 'monthly'
    check (statement_frequency in ('weekly', 'monthly')),
  -- Monthly: day of month 1–31 (clamped to the last day in short months).
  -- Weekly:  ISO weekday 1 (Mon) – 7 (Sun).
  add column if not exists statement_day int not null default 1
    check (statement_day between 1 and 31),
  add column if not exists statement_min_balance_pence int not null default 0,
  add column if not exists statement_email_subject text not null default '',
  add column if not exists statement_email_body text not null default '';

-- ── Send log ────────────────────────────────────────────────────────────────
create table if not exists public.billing_statement_runs (
  id              uuid primary key default gen_random_uuid(),
  firm_id         uuid not null references public.firms(id) on delete cascade,
  client_id       uuid not null references public.clients(id) on delete cascade,
  sent_at         timestamptz not null default now(),
  -- 'auto' (the scheduled run) or 'manual' (someone pressed Send statement).
  trigger         text not null default 'auto' check (trigger in ('auto', 'manual')),
  mode            text not null default 'outstanding',
  outstanding_pence int not null default 0,
  sent_to         text,
  created_by      uuid references public.users(id) on delete set null
);

create index if not exists billing_statement_runs_firm_sent_idx
  on public.billing_statement_runs (firm_id, sent_at desc);
-- The scheduled run checks "did this client already get one today?".
create index if not exists billing_statement_runs_client_sent_idx
  on public.billing_statement_runs (client_id, sent_at desc);

alter table public.billing_statement_runs enable row level security;
drop policy if exists billing_statement_runs_firm_all on public.billing_statement_runs;
create policy billing_statement_runs_firm_all on public.billing_statement_runs
  for all using (
    firm_id = (select u.firm_id from public.users u where u.id = auth.uid())
  ) with check (
    firm_id = (select u.firm_id from public.users u where u.id = auth.uid())
  );
