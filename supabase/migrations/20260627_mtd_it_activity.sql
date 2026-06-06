-- ============================================================
--  MTD IT activity log — quarter status changes (drafts, completes, reopens)
-- ============================================================
--  Submissions and approval emails already live in their own tables
--  (mtd_it_submissions, mtd_it_quarter_approvals) and the History feed unions
--  them in. This table captures the one thing not otherwise recorded: who
--  changed a quarter's status and when.
-- ============================================================

create table if not exists public.mtd_it_activity (
  id          uuid primary key default gen_random_uuid(),
  firm_id     uuid not null references public.firms(id) on delete cascade,
  client_id   uuid references public.clients(id) on delete cascade,
  quarter_id  uuid references public.mtd_it_quarters(id) on delete set null,
  quarter     int,
  tax_year    int,
  user_id     uuid references public.users(id) on delete set null,
  kind        text not null,            -- 'status_change' (extensible)
  detail      text,                     -- e.g. the new status
  created_at  timestamptz not null default now()
);

create index if not exists mtd_it_activity_firm_idx on public.mtd_it_activity (firm_id, created_at desc);

alter table public.mtd_it_activity enable row level security;

create policy "mtd_it_activity_same_firm"
  on public.mtd_it_activity for all
  using (firm_id = public.my_firm_id())
  with check (firm_id = public.my_firm_id());
