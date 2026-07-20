-- Campaigns module — split-send batching + designed templates.
--
-- Batching: Gmail caps how much one mailbox may send per day, so a large
-- audience is now sent in daily batches instead of being refused. The whole
-- recipient list is frozen up front; `next_batch_at` says when the next slice
-- may go, and the campaigns-send cron resumes it while the campaign sits in
-- 'sending'.
alter table public.campaigns
  add column if not exists next_batch_at timestamptz;

-- Resume scan: campaigns mid-send whose next batch is due.
create index if not exists campaigns_next_batch_idx
  on public.campaigns (next_batch_at)
  where status = 'sending';

-- Templates can now store a newsletter-designer layout, not just compiled HTML,
-- so a designed campaign saved as a template stays editable as blocks.
alter table public.campaign_templates
  add column if not exists design jsonb;
