-- CH Secretarial — resumable refresh job state
--
-- The Companies House refresh used to try to fetch every limited-company
-- client in a single Vercel function invocation. Vercel's hard 5-minute
-- function cap plus CH's 5-minute rate-limit cool-off meant any firm with
-- more than ~200 companies (or any single 429 response) would time out and
-- silently leave the previous refresh in place.
--
-- This table stores per-firm "job in flight" state so the cron can do a
-- few minutes' work each tick, save its progress, and the next tick (the
-- existing every-30-minute cron) picks up where it left off. When the
-- remaining_numbers array empties out, the cron flushes the accumulated
-- results into ch_cache and clears the job row back to idle.
--
-- One row per firm (PK = firm_id). status starts at 'idle' so a missing
-- row is implicitly idle as well — saves a bunch of null checks.

create table if not exists public.ch_refresh_jobs (
  firm_id              uuid primary key references public.firms(id) on delete cascade,
  status               text not null default 'idle' check (status in ('idle', 'running')),
  refresh_type         text check (refresh_type in ('scheduled', 'manual')),
  started_at           timestamptz,
  last_tick_at         timestamptz,
  remaining_numbers    text[]  not null default '{}',
  processed_companies  jsonb   not null default '[]'::jsonb,
  error_count          int     not null default 0,
  total_count          int     not null default 0,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

-- No RLS needed — this table is only read/written by the cron worker
-- using the service-role client. Mark it as such so future-me doesn't
-- panic about the lack of policies.
comment on table public.ch_refresh_jobs is
  'CH refresh job state for resumable cron runs. Service-role only.';
