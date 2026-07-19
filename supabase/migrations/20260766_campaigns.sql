-- Campaigns module — intelligent client communications for the firm.
--
-- Phase 1 schema: saved audiences (segments built from live practice data),
-- campaigns (the email + its send state), per-recipient rows (the frozen list at
-- send time, plus engagement counters), an append-only event log (opens/clicks/
-- bounces/etc.), and a firm-wide unsubscribe suppression list.
--
-- Firm-scoped throughout, RLS on every table. The public tracking endpoints
-- (open pixel / click redirect / unsubscribe) write via the service-role client,
-- which bypasses RLS — so there is no anon insert policy here by design.

-- ── Audiences ─────────────────────────────────────────────────────────────────
-- A saved segment. `source` decides how membership is resolved:
--   dynamic     → evaluate `definition` (the rule tree) live at send/preview time
--   static      → `member_client_ids` is the frozen list (a dynamic audience snapshotted)
--   manual      → `member_client_ids` chosen by hand
--   spreadsheet → reserved for a later phase (CSV/Excel upload); definition holds the rows
create table if not exists public.campaign_audiences (
  id                uuid primary key default gen_random_uuid(),
  firm_id           uuid not null references public.firms(id) on delete cascade,
  name              text not null,
  description       text not null default '',
  source            text not null default 'dynamic'
                      check (source in ('dynamic', 'static', 'manual', 'spreadsheet')),
  -- Rule tree for dynamic audiences: { combinator, negate, rules: [Rule|Group] }
  definition        jsonb not null default '{}'::jsonb,
  -- Frozen membership for static/manual audiences.
  member_client_ids uuid[] not null default '{}',
  created_by        uuid references public.users(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists campaign_audiences_firm_idx
  on public.campaign_audiences (firm_id, updated_at desc);

alter table public.campaign_audiences enable row level security;
drop policy if exists campaign_audiences_firm_all on public.campaign_audiences;
create policy campaign_audiences_firm_all on public.campaign_audiences
  for all using (
    firm_id = (select u.firm_id from public.users u where u.id = auth.uid())
  ) with check (
    firm_id = (select u.firm_id from public.users u where u.id = auth.uid())
  );

-- ── Campaigns ─────────────────────────────────────────────────────────────────
create table if not exists public.campaigns (
  id                uuid primary key default gen_random_uuid(),
  firm_id           uuid not null references public.firms(id) on delete cascade,
  name              text not null default 'Untitled campaign',
  subject           text not null default '',
  preview_text      text not null default '',
  body_html         text not null default '',
  body_font         text,
  -- The Gmail address the campaign sends from (must match a connected mailbox).
  from_email        text,
  reply_to          text,
  audience_id       uuid references public.campaign_audiences(id) on delete set null,
  -- Snapshot of how the audience was resolved when the campaign was sent
  -- (definition + resolved client ids), so history is reproducible even if the
  -- saved audience later changes or is deleted.
  audience_snapshot jsonb,
  status            text not null default 'draft'
                      check (status in (
                        'draft', 'awaiting_review', 'changes_requested', 'approved',
                        'scheduled', 'sending', 'sent', 'paused', 'cancelled', 'failed'
                      )),
  -- Phase 1 only sends via the connected Gmail. 'bulk' reserved for a later
  -- Resend/SES path.
  send_mode         text not null default 'personal_gmail'
                      check (send_mode in ('personal_gmail', 'bulk')),
  scheduled_at      timestamptz,
  sent_at           timestamptz,
  -- Free-form campaign settings (dedupe rule, unsubscribe scope, tone, etc.).
  settings          jsonb not null default '{}'::jsonb,
  -- Denormalised counters kept in step with campaign_recipients for fast lists.
  stats             jsonb not null default '{}'::jsonb,
  created_by        uuid references public.users(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists campaigns_firm_idx
  on public.campaigns (firm_id, created_at desc);
create index if not exists campaigns_firm_status_idx
  on public.campaigns (firm_id, status);
-- The scheduled-send cron scans due campaigns.
create index if not exists campaigns_scheduled_idx
  on public.campaigns (scheduled_at)
  where status = 'scheduled';

alter table public.campaigns enable row level security;
drop policy if exists campaigns_firm_all on public.campaigns;
create policy campaigns_firm_all on public.campaigns
  for all using (
    firm_id = (select u.firm_id from public.users u where u.id = auth.uid())
  ) with check (
    firm_id = (select u.firm_id from public.users u where u.id = auth.uid())
  );

-- ── Recipients ────────────────────────────────────────────────────────────────
-- One row per recipient of a campaign, frozen at send time. Holds the merged
-- data used to personalise this recipient's copy, the Gmail message/thread ids
-- once sent, and per-recipient engagement counters (kept fast to read; the
-- authoritative event history lives in campaign_events).
create table if not exists public.campaign_recipients (
  id               uuid primary key default gen_random_uuid(),
  campaign_id      uuid not null references public.campaigns(id) on delete cascade,
  firm_id          uuid not null references public.firms(id) on delete cascade,
  client_id        uuid references public.clients(id) on delete set null,
  email            text not null,
  name             text not null default '',
  -- Resolved merge-field values for this recipient (client + custom fields).
  merge_data       jsonb not null default '{}'::jsonb,
  status           text not null default 'pending'
                      check (status in (
                        'pending', 'sent', 'delivered', 'bounced', 'failed',
                        'skipped', 'unsubscribed', 'suppressed'
                      )),
  message_id       text,
  thread_id        text,
  error            text,
  sent_at          timestamptz,
  opened_at        timestamptz,
  first_clicked_at timestamptz,
  open_count       int not null default 0,
  click_count      int not null default 0,
  bounced_at       timestamptz,
  unsubscribed_at  timestamptz,
  created_at       timestamptz not null default now()
);

create index if not exists campaign_recipients_campaign_idx
  on public.campaign_recipients (campaign_id, status);
create index if not exists campaign_recipients_firm_idx
  on public.campaign_recipients (firm_id);
create index if not exists campaign_recipients_client_idx
  on public.campaign_recipients (client_id);

alter table public.campaign_recipients enable row level security;
drop policy if exists campaign_recipients_firm_all on public.campaign_recipients;
create policy campaign_recipients_firm_all on public.campaign_recipients
  for all using (
    firm_id = (select u.firm_id from public.users u where u.id = auth.uid())
  ) with check (
    firm_id = (select u.firm_id from public.users u where u.id = auth.uid())
  );

-- ── Events ────────────────────────────────────────────────────────────────────
-- Append-only engagement log. Written by the public tracking endpoints (service
-- role) and by the send routine ('send'/'fail'). Reads are firm-scoped.
create table if not exists public.campaign_events (
  id            uuid primary key default gen_random_uuid(),
  firm_id       uuid not null references public.firms(id) on delete cascade,
  campaign_id   uuid not null references public.campaigns(id) on delete cascade,
  recipient_id  uuid references public.campaign_recipients(id) on delete cascade,
  type          text not null
                  check (type in ('send', 'fail', 'open', 'click', 'bounce', 'unsubscribe', 'reply')),
  url           text,
  user_agent    text,
  created_at    timestamptz not null default now()
);

create index if not exists campaign_events_campaign_idx
  on public.campaign_events (campaign_id, type, created_at desc);
create index if not exists campaign_events_recipient_idx
  on public.campaign_events (recipient_id);

alter table public.campaign_events enable row level security;
drop policy if exists campaign_events_firm_read on public.campaign_events;
create policy campaign_events_firm_read on public.campaign_events
  for select using (
    firm_id = (select u.firm_id from public.users u where u.id = auth.uid())
  );

-- ── Unsubscribes (suppression list) ───────────────────────────────────────────
-- A firm-wide do-not-market list. A recipient who unsubscribes is added here and
-- excluded from all future campaigns for that firm. `scope` lets a later phase
-- distinguish marketing opt-out from a full do-not-contact.
create table if not exists public.campaign_unsubscribes (
  id          uuid primary key default gen_random_uuid(),
  firm_id     uuid not null references public.firms(id) on delete cascade,
  email       text not null,
  client_id   uuid references public.clients(id) on delete set null,
  scope       text not null default 'marketing'
                check (scope in ('marketing', 'all')),
  campaign_id uuid references public.campaigns(id) on delete set null,
  created_at  timestamptz not null default now(),
  unique (firm_id, email)
);

create index if not exists campaign_unsubscribes_firm_idx
  on public.campaign_unsubscribes (firm_id, email);

alter table public.campaign_unsubscribes enable row level security;
drop policy if exists campaign_unsubscribes_firm_all on public.campaign_unsubscribes;
create policy campaign_unsubscribes_firm_all on public.campaign_unsubscribes
  for all using (
    firm_id = (select u.firm_id from public.users u where u.id = auth.uid())
  ) with check (
    firm_id = (select u.firm_id from public.users u where u.id = auth.uid())
  );
