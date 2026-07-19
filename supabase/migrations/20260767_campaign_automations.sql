-- Campaigns module — Automations.
--
-- An automation is a saved trigger + email that SMITH fires on its own:
--   • 'recurring'  — send to a saved audience on a schedule (monthly / weekly)
--   • event-based  — when clients newly match a practice condition (year end or
--     confirmation statement approaching, invoice overdue, MTD quarter
--     outstanding, task overdue), send them the email once (with a per-client
--     cooldown so they aren't re-emailed every day the condition holds).
--
-- Each firing is delivered as a real Campaign (so tracking + reports work
-- uniformly), and every per-client send is logged in campaign_automation_runs —
-- which is also what makes the daily cron idempotent.

create table if not exists public.campaign_automations (
  id               uuid primary key default gen_random_uuid(),
  firm_id          uuid not null references public.firms(id) on delete cascade,
  name             text not null default 'Untitled automation',
  status           text not null default 'paused' check (status in ('active', 'paused')),
  trigger_type     text not null default 'recurring'
                     check (trigger_type in (
                       'recurring', 'year_end_approaching', 'cs_approaching',
                       'invoice_overdue', 'mtd_quarter_outstanding', 'task_overdue'
                     )),
  -- recurring: { frequency: 'monthly'|'weekly', day: int, hour: int }
  -- event:     { days?: int }  (lead time for the *_approaching triggers)
  trigger_config   jsonb not null default '{}'::jsonb,
  -- Only used by 'recurring' — the saved audience to send to.
  audience_id      uuid references public.campaign_audiences(id) on delete set null,
  subject          text not null default '',
  preview_text     text not null default '',
  body_html        text not null default '',
  body_font        text,
  from_email       text,
  reply_to         text,
  -- When true a firing creates a Campaign in 'awaiting_review' rather than
  -- sending — a human approves it. Defaults to true: automations don't blast
  -- clients unattended unless the firm opts in.
  require_approval boolean not null default true,
  settings         jsonb not null default '{}'::jsonb,
  last_run_at      timestamptz,
  next_run_at      timestamptz,
  created_by       uuid references public.users(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists campaign_automations_firm_idx
  on public.campaign_automations (firm_id, updated_at desc);
-- The daily cron scans active automations.
create index if not exists campaign_automations_active_idx
  on public.campaign_automations (status) where status = 'active';

alter table public.campaign_automations enable row level security;
drop policy if exists campaign_automations_firm_all on public.campaign_automations;
create policy campaign_automations_firm_all on public.campaign_automations
  for all using (
    firm_id = (select u.firm_id from public.users u where u.id = auth.uid())
  ) with check (
    firm_id = (select u.firm_id from public.users u where u.id = auth.uid())
  );

-- ── Per-client run log (cooldown / idempotency) ───────────────────────────────
create table if not exists public.campaign_automation_runs (
  id             uuid primary key default gen_random_uuid(),
  firm_id        uuid not null references public.firms(id) on delete cascade,
  automation_id  uuid not null references public.campaign_automations(id) on delete cascade,
  client_id      uuid references public.clients(id) on delete set null,
  email          text,
  campaign_id    uuid references public.campaigns(id) on delete set null,
  status         text not null default 'sent'
                   check (status in ('sent', 'skipped', 'failed', 'drafted')),
  created_at     timestamptz not null default now()
);

-- Cooldown lookup: "did this automation already email this client recently?"
create index if not exists campaign_automation_runs_lookup_idx
  on public.campaign_automation_runs (automation_id, client_id, created_at desc);
create index if not exists campaign_automation_runs_firm_idx
  on public.campaign_automation_runs (firm_id, created_at desc);

alter table public.campaign_automation_runs enable row level security;
drop policy if exists campaign_automation_runs_firm_read on public.campaign_automation_runs;
create policy campaign_automation_runs_firm_read on public.campaign_automation_runs
  for select using (
    firm_id = (select u.firm_id from public.users u where u.id = auth.uid())
  );
