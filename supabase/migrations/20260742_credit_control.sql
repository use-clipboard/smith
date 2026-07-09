-- Billing module — Phase C: credit control + auto-chaser.
--
-- credit_control_stages = the firm's editable reminder ladder (Chaser-style).
-- credit_control_events  = the per-invoice activity log (reminders sent, calls,
--                          promises to pay, escalations, notes, pause/resume).
-- A daily cron (/api/billing/credit-control/run) walks overdue invoices and
-- fires the appropriate stage once each. Firm-scoped, like the rest of billing.

-- ─── Reminder ladder (one row per stage, per firm) ───────────────────────────
create table if not exists public.credit_control_stages (
  id           uuid primary key default gen_random_uuid(),
  firm_id      uuid not null references public.firms(id) on delete cascade,
  position     integer not null default 0,
  stage_key    text not null,                 -- stable id used to dedupe sends
  name         text not null,
  tone         text not null default 'reminder'
                 check (tone in ('friendly','reminder','firm','final','legal')),
  offset_days  integer not null default 7,    -- days relative to due date (neg = before due)
  subject      text not null default '',
  body         text not null default '',
  enabled      boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (firm_id, stage_key)
);

create index if not exists cc_stages_firm_idx on public.credit_control_stages (firm_id, position);

alter table public.credit_control_stages enable row level security;
drop policy if exists cc_stages_firm_all on public.credit_control_stages;
create policy cc_stages_firm_all on public.credit_control_stages
  for all using (
    firm_id = (select u.firm_id from public.users u where u.id = auth.uid())
  ) with check (
    firm_id = (select u.firm_id from public.users u where u.id = auth.uid())
  );

-- ─── Credit-control events (activity timeline per invoice) ────────────────────
create table if not exists public.credit_control_events (
  id                   uuid primary key default gen_random_uuid(),
  firm_id              uuid not null references public.firms(id) on delete cascade,
  invoice_id           uuid references public.invoices(id) on delete cascade,
  client_id            uuid references public.clients(id) on delete set null,
  type                 text not null
                         check (type in ('reminder_sent','call_logged','promise_to_pay','escalated','note','paused','resumed')),
  stage_key            text,
  stage_name           text,
  channel              text,                   -- 'email' etc.
  subject              text,
  body                 text,
  promised_date        date,
  promised_amount_pence integer,
  note                 text,
  created_by           uuid references public.users(id) on delete set null,  -- null = cron
  created_at           timestamptz not null default now()
);

create index if not exists cc_events_invoice_idx on public.credit_control_events (invoice_id, created_at);
create index if not exists cc_events_firm_idx    on public.credit_control_events (firm_id, created_at);

alter table public.credit_control_events enable row level security;
drop policy if exists cc_events_firm_all on public.credit_control_events;
create policy cc_events_firm_all on public.credit_control_events
  for all using (
    firm_id = (select u.firm_id from public.users u where u.id = auth.uid())
  ) with check (
    firm_id = (select u.firm_id from public.users u where u.id = auth.uid())
  );

-- Per-invoice chase opt-out (default: chase, subject to the global toggle).
alter table public.invoices
  add column if not exists auto_chase boolean not null default true;

-- Firm-level auto-chaser configuration.
alter table public.billing_settings
  add column if not exists auto_chase_enabled     boolean not null default false,
  add column if not exists chase_weekdays_only     boolean not null default true,
  add column if not exists chase_min_balance_pence integer not null default 0,
  add column if not exists chase_reply_to          text not null default '';
