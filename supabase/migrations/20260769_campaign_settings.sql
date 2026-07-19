-- Campaigns module — firm-level settings.
--
-- One row per firm holding the defaults applied to every campaign: reply-to
-- address, unsubscribe footer, deduplication of shared email addresses, and a
-- communication-frequency guard. Read at send time (campaign-level settings
-- override these).

create table if not exists public.campaign_settings (
  firm_id             uuid primary key references public.firms(id) on delete cascade,
  reply_to            text,
  include_unsubscribe boolean not null default true,
  unsubscribe_footer  text not null default '',
  -- 'per_email'  = one email per address (collapse duplicates)
  -- 'per_client' = one email per client record (a shared address gets several)
  default_dedupe      text not null default 'per_email'
                        check (default_dedupe in ('per_email', 'per_client')),
  -- Warn when a client has received a campaign within this many days (0 = off).
  -- Stored now; enforcement is a later phase.
  frequency_guard_days int not null default 0,
  updated_at          timestamptz not null default now()
);

alter table public.campaign_settings enable row level security;
drop policy if exists campaign_settings_firm_all on public.campaign_settings;
create policy campaign_settings_firm_all on public.campaign_settings
  for all using (
    firm_id = (select u.firm_id from public.users u where u.id = auth.uid())
  ) with check (
    firm_id = (select u.firm_id from public.users u where u.id = auth.uid())
  );
