-- CH Secretarial — link tasks to live Companies House deadlines
--
-- One row per (task, deadline) pair. A task can be linked to one deadline
-- type for a single client. A deadline can have multiple tasks pointing at
-- it (e.g. Draft → Review → File for one Accounts Due).
--
-- `offset_days` lets a task be due X days before (negative) or after
-- (positive) the deadline. `last_synced_deadline` is the most recent CH
-- deadline value we wrote into the linked task — used to detect:
--   - small slides (< 90 days)  → just update the task's due_date in place
--   - large jumps (≥ 90 days)   → annual renewal; auto-complete the current
--                                 task with an audit note and clone a new
--                                 task for the new cycle, repointing the link
--
-- The sync logic itself lives in lib/chDeadlineSync.ts and runs after every
-- ch_cache upsert (both scheduled cron and manual user-driven refresh).

create table if not exists public.ch_deadline_task_links (
  id                    uuid primary key default gen_random_uuid(),
  firm_id               uuid not null references public.firms(id) on delete cascade,
  client_id             uuid not null references public.clients(id) on delete cascade,
  task_id               uuid not null references public.tasks(id) on delete cascade,
  deadline_type         text not null check (deadline_type in
                          ('accounts_due', 'cs_due', 'officer_idv_due', 'psc_idv_due')),
  offset_days           int  not null default 0,
  last_synced_deadline  date,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index if not exists ch_deadline_task_links_firm_client_idx
  on public.ch_deadline_task_links (firm_id, client_id);

create index if not exists ch_deadline_task_links_task_idx
  on public.ch_deadline_task_links (task_id);
