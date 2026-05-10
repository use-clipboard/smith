-- ============================================================
--  HR module — Phase 2a
-- ============================================================
--  Adds:
--   • Absence records — sickness, unpaid leave, compassionate, jury duty,
--     other. Recorded by manager/admin (no staff request flow). Optional
--     evidence file (fit note URL), return-to-work tracking.
-- ============================================================

create table if not exists public.hr_absence_records (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references public.firms on delete cascade,
  user_id uuid not null references public.users on delete cascade,
  -- Snapshot of the manager at the time of recording, for audit if re-orgs happen
  manager_id uuid references public.users on delete set null,
  -- Whoever logged this absence (typically the manager, sometimes admin/HR)
  recorded_by uuid references public.users on delete set null,
  start_date date not null,
  start_half text not null default 'full' check (start_half in ('full', 'morning', 'afternoon')),
  end_date date not null,
  end_half text not null default 'full' check (end_half in ('full', 'morning', 'afternoon')),
  -- Pre-computed working-day total for Bradford Factor and reporting
  total_days numeric not null,
  category text not null check (category in (
    'sickness', 'unpaid_leave', 'compassionate', 'jury_duty', 'medical_appointment', 'other'
  )),
  reason text,
  -- URL to a fit note / supporting doc, optional
  evidence_url text,
  -- Return-to-work meeting tracking (a UK HR best practice for sickness)
  return_to_work_done boolean not null default false,
  return_to_work_notes text,
  -- Optional Google Calendar push, mirroring the holiday flow
  pushed_to_calendar boolean not null default false,
  google_calendar_event_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_date >= start_date)
);

create index if not exists hr_absence_firm_user_idx on public.hr_absence_records (firm_id, user_id, start_date desc);
create index if not exists hr_absence_manager_idx on public.hr_absence_records (manager_id, start_date desc);
create index if not exists hr_absence_category_idx on public.hr_absence_records (firm_id, category);

alter table public.hr_absence_records enable row level security;

-- Read: own records, manager's reports, admin sees all
create policy "hr_absence: read own + reports + admin"
  on public.hr_absence_records for select
  using (
    firm_id = public.my_firm_id() and (
      user_id = auth.uid()
      or manager_id = auth.uid()
      or exists (
        select 1 from public.users
        where id = auth.uid() and role = 'admin' and firm_id = public.my_firm_id()
      )
    )
  );

-- Insert: only manager-of-target or admin (staff cannot self-log absences;
-- a manager records on the staff member's behalf)
create policy "hr_absence: insert by manager or admin"
  on public.hr_absence_records for insert
  with check (
    firm_id = public.my_firm_id() and exists (
      select 1 from public.users u
      where u.id = user_id and (
        u.manager_id = auth.uid()
        or exists (
          select 1 from public.users a
          where a.id = auth.uid() and a.role = 'admin' and a.firm_id = public.my_firm_id()
        )
      )
    )
  );

-- Update: manager of target, or admin
create policy "hr_absence: update by manager or admin"
  on public.hr_absence_records for update
  using (
    firm_id = public.my_firm_id() and (
      manager_id = auth.uid()
      or exists (
        select 1 from public.users
        where id = auth.uid() and role = 'admin' and firm_id = public.my_firm_id()
      )
    )
  );

-- Delete: admin only
create policy "hr_absence: delete admin only"
  on public.hr_absence_records for delete
  using (
    firm_id = public.my_firm_id() and exists (
      select 1 from public.users
      where id = auth.uid() and role = 'admin' and firm_id = public.my_firm_id()
    )
  );
