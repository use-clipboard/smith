-- CH Secretarial — deadline link resilience fields
--
-- Adds the state-tracking columns the sync engine needs to handle:
--   - paused links (module disabled, transient CH outage)
--   - broken links (client's CH number changed, repeated refresh failures)
--   - failure counting (3 consecutive failures → broken)
--   - a snapshot of the CH number at link creation, so we can detect when
--     the client's CH number is later changed and break the link safely.
--
-- The link table itself was created in 20260529_ch_deadline_task_links.sql.
-- This migration is additive — running it after the previous one leaves
-- existing rows in the 'active' state.

alter table public.ch_deadline_task_links
  add column if not exists status text not null default 'active'
    check (status in ('active', 'paused', 'broken')),
  add column if not exists linked_company_number text,
  add column if not exists consecutive_failures int not null default 0,
  add column if not exists last_synced_at timestamptz,
  add column if not exists last_error text;

create index if not exists ch_deadline_task_links_status_idx
  on public.ch_deadline_task_links (firm_id, status);

comment on column public.ch_deadline_task_links.status is
  'active = syncing; paused = will resume when CH data returns; broken = needs manual review';
comment on column public.ch_deadline_task_links.linked_company_number is
  'Snapshot of clients.companies_house_id at link creation. If the client''s CH number later changes, the link is marked broken.';
comment on column public.ch_deadline_task_links.consecutive_failures is
  'Increments each refresh where the company is missing/errored. Resets to 0 on a successful sync. Reaching 3 marks the link broken.';
