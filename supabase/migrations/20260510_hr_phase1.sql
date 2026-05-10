-- ============================================================
--  HR module — Phase 1
-- ============================================================
--  Adds:
--   • Departments per firm
--   • Employment fields on users (department_id, manager_id, job_title, job_description,
--     employment_start_date, holiday_entitlement_days_override)
--   • Per-firm HR settings (entitlement defaults, holiday year reset, half-day boundaries)
--   • Holiday request workflow (status, half-day support, calendar push, snapshot
--     of manager at request time so re-orgs don't break audit trail)
--   • Manager-direct holiday/absence entries (no request flow)
--   • RLS so staff see only their own + their team; managers see their reports;
--     admins see everything in their firm
-- ============================================================

-- ── Departments ──────────────────────────────────────────────
create table if not exists public.hr_departments (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references public.firms on delete cascade,
  name text not null,
  description text,
  parent_department_id uuid references public.hr_departments on delete set null,
  -- Used to colour the department's nodes on the org chart. Null = default palette.
  color text,
  display_order int default 0,
  created_at timestamptz not null default now(),
  unique (firm_id, name)
);
create index if not exists hr_departments_firm_idx on public.hr_departments (firm_id);

alter table public.hr_departments enable row level security;

-- Anyone in the firm can see departments (for org chart, request form, etc.)
create policy "hr_departments: same firm read"
  on public.hr_departments for select
  using (firm_id = public.my_firm_id());

-- Only admins can write departments
create policy "hr_departments: admin write"
  on public.hr_departments for all
  using (firm_id = public.my_firm_id() and exists (
    select 1 from public.users where id = auth.uid() and role = 'admin'
  ))
  with check (firm_id = public.my_firm_id() and exists (
    select 1 from public.users where id = auth.uid() and role = 'admin'
  ));

-- ── Employment fields on users ──────────────────────────────
alter table public.users
  add column if not exists department_id uuid references public.hr_departments on delete set null,
  add column if not exists manager_id uuid references public.users on delete set null,
  add column if not exists job_title text,
  add column if not exists job_description text,
  add column if not exists employment_start_date date,
  -- NULL = use the firm-wide default. Numeric to allow half-days.
  add column if not exists holiday_entitlement_days_override numeric;

create index if not exists users_manager_idx on public.users (manager_id);
create index if not exists users_department_idx on public.users (department_id);

-- ── Per-firm HR settings ────────────────────────────────────
create table if not exists public.firm_hr_settings (
  firm_id uuid primary key references public.firms on delete cascade,
  -- Holiday year boundaries (admin-configurable). Defaults are 1 Jan.
  holiday_reset_month int not null default 1 check (holiday_reset_month between 1 and 12),
  holiday_reset_day int not null default 1 check (holiday_reset_day between 1 and 31),
  default_annual_holiday_days numeric not null default 28,
  -- Half-day boundaries — stored as time-of-day, firm-wide.
  morning_start time not null default '09:00',
  morning_end time not null default '13:00',
  afternoon_start time not null default '13:00',
  afternoon_end time not null default '17:30',
  -- Toggle: when a manager approves, default state of "Add to Google Calendar" switch.
  push_to_calendar_default boolean not null default true,
  -- The user designated to receive confidential HR disclosures (Phase 2 placeholder).
  confidential_recipient_user_id uuid references public.users on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.firm_hr_settings enable row level security;

create policy "firm_hr_settings: same firm read"
  on public.firm_hr_settings for select
  using (firm_id = public.my_firm_id());

create policy "firm_hr_settings: admin write"
  on public.firm_hr_settings for all
  using (firm_id = public.my_firm_id() and exists (
    select 1 from public.users where id = auth.uid() and role = 'admin'
  ))
  with check (firm_id = public.my_firm_id() and exists (
    select 1 from public.users where id = auth.uid() and role = 'admin'
  ));

-- ── Holiday requests ────────────────────────────────────────
-- A single row covers one request, which may span multiple days.
-- Half-day support:
--   • For full days, start_half = 'full' and end_half = 'full'.
--   • For a single half-day, start_date == end_date and the half is set on start_half.
--   • For multi-day spans starting/ending mid-day, e.g. afternoon Mon to morning Wed,
--     start_half = 'afternoon', end_half = 'morning'.
create table if not exists public.hr_holiday_requests (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references public.firms on delete cascade,
  user_id uuid not null references public.users on delete cascade, -- the requester
  -- Snapshot of the manager at the time the request was raised. If a re-org
  -- happens, the original manager is preserved on existing requests for audit.
  manager_id uuid references public.users on delete set null,
  start_date date not null,
  start_half text not null default 'full' check (start_half in ('full', 'morning', 'afternoon')),
  end_date date not null,
  end_half text not null default 'full' check (end_half in ('full', 'morning', 'afternoon')),
  -- Pre-computed working-day total for entitlement maths. Includes weekends if
  -- present in the span; firms can configure this further later if needed.
  total_days numeric not null,
  reason text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  -- 'request' = staff-raised; 'direct' = manager-recorded directly (no approval flow)
  source text not null default 'request' check (source in ('request', 'direct')),
  decided_by uuid references public.users on delete set null,
  decided_at timestamptz,
  rejection_reason text,
  -- Whether the manager pushed this to the staff member's Google Calendar
  pushed_to_calendar boolean not null default false,
  google_calendar_event_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_date >= start_date)
);

create index if not exists hr_holidays_firm_user_idx on public.hr_holiday_requests (firm_id, user_id);
create index if not exists hr_holidays_manager_status_idx on public.hr_holiday_requests (manager_id, status);
create index if not exists hr_holidays_dates_idx on public.hr_holiday_requests (firm_id, start_date, end_date);

alter table public.hr_holiday_requests enable row level security;

-- Read: requester + their manager + admins of the firm
create policy "hr_holidays: read own + reports + admin"
  on public.hr_holiday_requests for select
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

-- Insert: anyone in the firm can request for themselves, OR managers/admins
-- can record on behalf of a team member ("source = 'direct'").
create policy "hr_holidays: insert own or as manager/admin"
  on public.hr_holiday_requests for insert
  with check (
    firm_id = public.my_firm_id() and (
      user_id = auth.uid()
      or exists (
        select 1 from public.users u
        where u.id = user_id and (
          u.manager_id = auth.uid()
          or exists (
            select 1 from public.users a
            where a.id = auth.uid() and a.role = 'admin' and a.firm_id = public.my_firm_id()
          )
        )
      )
    )
  );

-- Update: requester (cancel only — handled in API), manager (approve/reject/edit),
-- admin (anything).
create policy "hr_holidays: update by requester, manager, admin"
  on public.hr_holiday_requests for update
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

-- Delete: admin only (audit-safe; everything else uses status = 'cancelled')
create policy "hr_holidays: admin delete"
  on public.hr_holiday_requests for delete
  using (
    firm_id = public.my_firm_id() and exists (
      select 1 from public.users
      where id = auth.uid() and role = 'admin' and firm_id = public.my_firm_id()
    )
  );
