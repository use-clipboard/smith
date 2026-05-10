-- ============================================================
--  HR — Quarterly manager briefings
-- ============================================================
--  Auto-generated reading material for managers covering UK
--  employment law changes / training tips. Generated quarterly
--  by a Vercel cron call into Anthropic with web search scoped
--  to UK authoritative sources.
-- ============================================================

create table if not exists public.hr_manager_briefings (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references public.firms on delete cascade,
  -- The quarter this briefing covers, in YYYY-Q form (e.g. '2026-Q2')
  quarter text not null,
  -- Inclusive period the briefing reflects on
  period_start date not null,
  period_end date not null,
  -- High-level one-paragraph summary used in lists / emails
  summary text,
  -- Structured content: { sections: [{ heading, body, sources: [{label, url}] }], action_items: [..], training_tips: [..] }
  content jsonb,
  status text not null default 'success' check (status in ('success', 'failed')),
  error_detail text,
  -- The Anthropic model id used to generate
  model text,
  generated_at timestamptz not null default now(),
  unique (firm_id, quarter)
);
create index if not exists hr_briefings_firm_idx on public.hr_manager_briefings (firm_id, generated_at desc);

alter table public.hr_manager_briefings enable row level security;

-- All firm users can read; insert/update via service role only (no client policy).
create policy "hr_briefings: same firm read"
  on public.hr_manager_briefings for select
  using (firm_id = public.my_firm_id());

-- Per-firm opt-out flag in firm_hr_settings
alter table public.firm_hr_settings
  add column if not exists manager_briefings_enabled boolean not null default true;
