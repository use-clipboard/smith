-- Campaigns module — reply tracking.
--
-- When a campaign recipient replies, the reply-scan cron records it here and
-- links the thread to the client in Email Triage (via email_allocations +
-- client_timeline_notes, the same path a manual allocation uses). `replied_at`
-- also stops the scan re-processing a recipient once a reply is found.

alter table public.campaign_recipients
  add column if not exists replied_at timestamptz;

create index if not exists campaign_recipients_replied_idx
  on public.campaign_recipients (campaign_id) where replied_at is not null;

-- The scan looks up unreplied recipients by thread within a firm.
create index if not exists campaign_recipients_thread_idx
  on public.campaign_recipients (firm_id, thread_id) where thread_id is not null;
