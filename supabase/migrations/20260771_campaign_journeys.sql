-- Campaigns module — multi-step automation journeys.
--
-- An automation can now be a linear journey: a sequence of steps (send email /
-- wait N days / check a goal) that each enrolled recipient progresses through
-- independently. `mode='single'` keeps the original trigger→one-email behaviour;
-- `mode='journey'` uses `steps` and enrolls recipients into the table below.

alter table public.campaign_automations
  add column if not exists mode text not null default 'single'
    check (mode in ('single', 'journey')),
  -- Ordered step list for journeys:
  --   { id, type:'email', subject, preview_text, body_html }
  --   { id, type:'wait', days }
  --   { id, type:'check', goal }   goal met → journey completes; else continue
  add column if not exists steps jsonb not null default '[]'::jsonb;

-- Per-recipient journey state.
create table if not exists public.campaign_journey_enrollments (
  id                uuid primary key default gen_random_uuid(),
  firm_id           uuid not null references public.firms(id) on delete cascade,
  automation_id     uuid not null references public.campaign_automations(id) on delete cascade,
  client_id         uuid references public.clients(id) on delete set null,
  email             text not null,
  name              text not null default '',
  merge_data        jsonb not null default '{}'::jsonb,
  -- Index of the next step to run.
  step_index        int not null default 0,
  -- When step_index is due to run (a 'wait' pushes this into the future).
  next_action_at    timestamptz not null default now(),
  status            text not null default 'active'
                      check (status in ('active', 'completed', 'exited', 'failed')),
  -- The campaign_recipients row for the most recent email — used by 'check'
  -- steps to read opens/clicks and by goal checks as the "since" anchor.
  last_recipient_id uuid references public.campaign_recipients(id) on delete set null,
  last_sent_at      timestamptz,
  enrolled_at       timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- Don't enroll the same client (or address) twice into one automation at once.
create unique index if not exists campaign_journey_enrollments_client_uniq
  on public.campaign_journey_enrollments (automation_id, client_id)
  where client_id is not null;
create unique index if not exists campaign_journey_enrollments_email_uniq
  on public.campaign_journey_enrollments (automation_id, lower(email));
-- The advance cron scans due, active enrollments.
create index if not exists campaign_journey_enrollments_due_idx
  on public.campaign_journey_enrollments (next_action_at)
  where status = 'active';

alter table public.campaign_journey_enrollments enable row level security;
drop policy if exists campaign_journey_enrollments_firm_read on public.campaign_journey_enrollments;
create policy campaign_journey_enrollments_firm_read on public.campaign_journey_enrollments
  for select using (
    firm_id = (select u.firm_id from public.users u where u.id = auth.uid())
  );
