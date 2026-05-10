-- ============================================================
--  HR module — Phase 3
-- ============================================================
--  Personnel files: right-to-work, emergency contacts, probation,
--  onboarding (template + per-hire instances), training/CPD, 1:1
--  meetings, performance appraisals, salary records (admin-only with
--  audit), DSE assessments, TOIL balances, leaver workflow.
--
--  Plus: users.date_of_birth + show_birthday_to_team for the org-chart
--  birthday widget.
--
--  RLS pattern: most tables follow "subject can read; manager can read;
--  admin can read/write everything in firm". Salary is admin-only with
--  read auditing. 1:1 notes are visible to both parties.
-- ============================================================

-- ── Users — DOB + birthday opt-in ───────────────────────────
alter table public.users
  add column if not exists date_of_birth date,
  add column if not exists show_birthday_to_team boolean not null default false;

-- ── Right-to-work ───────────────────────────────────────────
create table if not exists public.hr_right_to_work (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references public.firms on delete cascade,
  user_id uuid not null references public.users on delete cascade,
  document_type text not null check (document_type in ('passport', 'brp', 'share_code', 'visa', 'other')),
  document_reference text,
  expiry_date date,
  evidence_url text,
  checked_by uuid references public.users on delete set null,
  checked_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (firm_id, user_id)
);
create index if not exists hr_rtw_firm_user_idx on public.hr_right_to_work (firm_id, user_id);
alter table public.hr_right_to_work enable row level security;

create policy "hr_rtw: read self/manager/admin"
  on public.hr_right_to_work for select
  using (
    firm_id = public.my_firm_id() and (
      user_id = auth.uid()
      or exists (select 1 from public.users u where u.id = user_id and u.manager_id = auth.uid())
      or exists (select 1 from public.users where id = auth.uid() and role = 'admin' and firm_id = public.my_firm_id())
    )
  );
create policy "hr_rtw: admin write"
  on public.hr_right_to_work for all
  using (firm_id = public.my_firm_id() and exists (select 1 from public.users where id = auth.uid() and role = 'admin'))
  with check (firm_id = public.my_firm_id() and exists (select 1 from public.users where id = auth.uid() and role = 'admin'));

-- ── Emergency contacts ──────────────────────────────────────
create table if not exists public.hr_emergency_contacts (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references public.firms on delete cascade,
  user_id uuid not null references public.users on delete cascade,
  name text not null,
  relationship text,
  phone text,
  email text,
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists hr_emergency_firm_user_idx on public.hr_emergency_contacts (firm_id, user_id);
alter table public.hr_emergency_contacts enable row level security;

-- Read: self, manager, admin
create policy "hr_emergency: read self/manager/admin"
  on public.hr_emergency_contacts for select
  using (
    firm_id = public.my_firm_id() and (
      user_id = auth.uid()
      or exists (select 1 from public.users u where u.id = user_id and u.manager_id = auth.uid())
      or exists (select 1 from public.users where id = auth.uid() and role = 'admin' and firm_id = public.my_firm_id())
    )
  );
-- Write: self only (staff manage their own emergency contacts), or admin
create policy "hr_emergency: write self or admin"
  on public.hr_emergency_contacts for all
  using (
    firm_id = public.my_firm_id() and (
      user_id = auth.uid()
      or exists (select 1 from public.users where id = auth.uid() and role = 'admin' and firm_id = public.my_firm_id())
    )
  )
  with check (
    firm_id = public.my_firm_id() and (
      user_id = auth.uid()
      or exists (select 1 from public.users where id = auth.uid() and role = 'admin' and firm_id = public.my_firm_id())
    )
  );

-- ── Probation ───────────────────────────────────────────────
create table if not exists public.hr_probation (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references public.firms on delete cascade,
  user_id uuid not null references public.users on delete cascade,
  start_date date not null,
  end_date date,                     -- planned end of probation
  status text not null default 'active' check (status in ('active', 'passed', 'failed', 'extended', 'cancelled')),
  outcome_date date,
  outcome_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (firm_id, user_id)
);
create index if not exists hr_probation_firm_user_idx on public.hr_probation (firm_id, user_id);
alter table public.hr_probation enable row level security;

create policy "hr_probation: read self/manager/admin"
  on public.hr_probation for select
  using (
    firm_id = public.my_firm_id() and (
      user_id = auth.uid()
      or exists (select 1 from public.users u where u.id = user_id and u.manager_id = auth.uid())
      or exists (select 1 from public.users where id = auth.uid() and role = 'admin' and firm_id = public.my_firm_id())
    )
  );
create policy "hr_probation: admin/manager write"
  on public.hr_probation for all
  using (
    firm_id = public.my_firm_id() and (
      exists (select 1 from public.users u where u.id = user_id and u.manager_id = auth.uid())
      or exists (select 1 from public.users where id = auth.uid() and role = 'admin' and firm_id = public.my_firm_id())
    )
  )
  with check (
    firm_id = public.my_firm_id() and (
      exists (select 1 from public.users u where u.id = user_id and u.manager_id = auth.uid())
      or exists (select 1 from public.users where id = auth.uid() and role = 'admin' and firm_id = public.my_firm_id())
    )
  );

-- ── Onboarding template (one set of items per firm) ─────────
create table if not exists public.hr_onboarding_template (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references public.firms on delete cascade,
  title text not null,
  description text,
  default_assignee_role text check (default_assignee_role in ('admin', 'manager', 'staff')),
  due_days_after_start int not null default 0,
  display_order int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists hr_onboarding_template_firm_idx on public.hr_onboarding_template (firm_id, display_order);
alter table public.hr_onboarding_template enable row level security;
create policy "hr_onboarding_template: same firm read"
  on public.hr_onboarding_template for select
  using (firm_id = public.my_firm_id());
create policy "hr_onboarding_template: admin write"
  on public.hr_onboarding_template for all
  using (firm_id = public.my_firm_id() and exists (select 1 from public.users where id = auth.uid() and role = 'admin'))
  with check (firm_id = public.my_firm_id() and exists (select 1 from public.users where id = auth.uid() and role = 'admin'));

-- ── Onboarding instance (per new joiner) ────────────────────
create table if not exists public.hr_onboarding_items (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references public.firms on delete cascade,
  user_id uuid not null references public.users on delete cascade,
  title text not null,
  description text,
  due_date date,
  status text not null default 'pending' check (status in ('pending', 'done', 'skipped', 'na')),
  done_by uuid references public.users on delete set null,
  done_at timestamptz,
  display_order int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists hr_onboarding_items_user_idx on public.hr_onboarding_items (user_id, status);
alter table public.hr_onboarding_items enable row level security;
create policy "hr_onboarding_items: read self/manager/admin"
  on public.hr_onboarding_items for select
  using (
    firm_id = public.my_firm_id() and (
      user_id = auth.uid()
      or exists (select 1 from public.users u where u.id = user_id and u.manager_id = auth.uid())
      or exists (select 1 from public.users where id = auth.uid() and role = 'admin' and firm_id = public.my_firm_id())
    )
  );
create policy "hr_onboarding_items: write self/manager/admin"
  on public.hr_onboarding_items for all
  using (
    firm_id = public.my_firm_id() and (
      user_id = auth.uid()
      or exists (select 1 from public.users u where u.id = user_id and u.manager_id = auth.uid())
      or exists (select 1 from public.users where id = auth.uid() and role = 'admin' and firm_id = public.my_firm_id())
    )
  )
  with check (
    firm_id = public.my_firm_id() and (
      user_id = auth.uid()
      or exists (select 1 from public.users u where u.id = user_id and u.manager_id = auth.uid())
      or exists (select 1 from public.users where id = auth.uid() and role = 'admin' and firm_id = public.my_firm_id())
    )
  );

-- ── Training & CPD ──────────────────────────────────────────
create table if not exists public.hr_training_records (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references public.firms on delete cascade,
  user_id uuid not null references public.users on delete cascade,
  title text not null,
  provider text,
  hours numeric default 0,
  date_completed date,
  cpd_year text,                     -- '2026' etc — a tag for CPD year totals
  certificate_url text,
  notes text,
  created_at timestamptz not null default now()
);
create index if not exists hr_training_user_idx on public.hr_training_records (user_id, date_completed desc);
alter table public.hr_training_records enable row level security;
create policy "hr_training: read self/manager/admin"
  on public.hr_training_records for select
  using (
    firm_id = public.my_firm_id() and (
      user_id = auth.uid()
      or exists (select 1 from public.users u where u.id = user_id and u.manager_id = auth.uid())
      or exists (select 1 from public.users where id = auth.uid() and role = 'admin' and firm_id = public.my_firm_id())
    )
  );
create policy "hr_training: write self or admin"
  on public.hr_training_records for all
  using (
    firm_id = public.my_firm_id() and (
      user_id = auth.uid()
      or exists (select 1 from public.users where id = auth.uid() and role = 'admin' and firm_id = public.my_firm_id())
    )
  )
  with check (
    firm_id = public.my_firm_id() and (
      user_id = auth.uid()
      or exists (select 1 from public.users where id = auth.uid() and role = 'admin' and firm_id = public.my_firm_id())
    )
  );

-- ── 1:1 meetings ────────────────────────────────────────────
-- Both parties see all notes — trust + transparency.
create table if not exists public.hr_one_to_ones (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references public.firms on delete cascade,
  staff_user_id uuid not null references public.users on delete cascade,
  manager_user_id uuid not null references public.users on delete cascade,
  meeting_date date not null,
  notes text,
  action_items text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists hr_1to1_pair_idx on public.hr_one_to_ones (firm_id, staff_user_id, manager_user_id, meeting_date desc);
alter table public.hr_one_to_ones enable row level security;
create policy "hr_1to1: read parties"
  on public.hr_one_to_ones for select
  using (firm_id = public.my_firm_id() and (staff_user_id = auth.uid() or manager_user_id = auth.uid()));
create policy "hr_1to1: write parties"
  on public.hr_one_to_ones for all
  using (firm_id = public.my_firm_id() and (staff_user_id = auth.uid() or manager_user_id = auth.uid()))
  with check (firm_id = public.my_firm_id() and (staff_user_id = auth.uid() or manager_user_id = auth.uid()));

-- ── Appraisals ──────────────────────────────────────────────
create table if not exists public.hr_appraisals (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references public.firms on delete cascade,
  user_id uuid not null references public.users on delete cascade,
  reviewer_id uuid references public.users on delete set null,
  period_start date,
  period_end date,
  rating text check (rating in ('exceeds', 'meets', 'developing', 'below')),
  achievements text,
  development_areas text,
  goals text,
  staff_comments text,
  status text not null default 'draft' check (status in ('draft', 'submitted', 'acknowledged')),
  submitted_at timestamptz,
  acknowledged_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists hr_appraisals_user_idx on public.hr_appraisals (user_id, period_end desc);
alter table public.hr_appraisals enable row level security;
create policy "hr_appraisals: read self/reviewer/admin"
  on public.hr_appraisals for select
  using (
    firm_id = public.my_firm_id() and (
      user_id = auth.uid()
      or reviewer_id = auth.uid()
      or exists (select 1 from public.users where id = auth.uid() and role = 'admin' and firm_id = public.my_firm_id())
    )
  );
create policy "hr_appraisals: write reviewer/admin or staff comments"
  on public.hr_appraisals for all
  using (
    firm_id = public.my_firm_id() and (
      reviewer_id = auth.uid()
      or user_id = auth.uid()  -- staff need write to add their comments + acknowledge
      or exists (select 1 from public.users where id = auth.uid() and role = 'admin' and firm_id = public.my_firm_id())
    )
  )
  with check (
    firm_id = public.my_firm_id() and (
      reviewer_id = auth.uid()
      or user_id = auth.uid()
      or exists (select 1 from public.users where id = auth.uid() and role = 'admin' and firm_id = public.my_firm_id())
    )
  );

-- ── Salary records (sensitive, admin-only with read audit) ──
create table if not exists public.hr_salary_records (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references public.firms on delete cascade,
  user_id uuid not null references public.users on delete cascade,
  effective_date date not null,
  annual_salary numeric not null,
  currency text not null default 'GBP',
  notes text,
  created_by uuid references public.users on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists hr_salary_user_idx on public.hr_salary_records (user_id, effective_date desc);
alter table public.hr_salary_records enable row level security;
-- The subject can read their own salary; admins can read everyone's. Not even
-- managers see staff salaries by default — that's a delicate area best left
-- to firm policy / explicit grant.
create policy "hr_salary: read self or admin"
  on public.hr_salary_records for select
  using (
    firm_id = public.my_firm_id() and (
      user_id = auth.uid()
      or exists (select 1 from public.users where id = auth.uid() and role = 'admin' and firm_id = public.my_firm_id())
    )
  );
create policy "hr_salary: admin write"
  on public.hr_salary_records for all
  using (firm_id = public.my_firm_id() and exists (select 1 from public.users where id = auth.uid() and role = 'admin'))
  with check (firm_id = public.my_firm_id() and exists (select 1 from public.users where id = auth.uid() and role = 'admin'));

-- Salary audit log (server-side inserts on every read)
create table if not exists public.hr_salary_audit (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references public.firms on delete cascade,
  salary_user_id uuid not null,                    -- whose salary was viewed
  accessed_by uuid not null references public.users on delete cascade,
  accessed_at timestamptz not null default now()
);
create index if not exists hr_salary_audit_subject_idx on public.hr_salary_audit (firm_id, salary_user_id, accessed_at desc);
alter table public.hr_salary_audit enable row level security;
-- The subject can see who's looked at their salary record; admins can see all
create policy "hr_salary_audit: read self or admin"
  on public.hr_salary_audit for select
  using (
    firm_id = public.my_firm_id() and (
      salary_user_id = auth.uid()
      or exists (select 1 from public.users where id = auth.uid() and role = 'admin' and firm_id = public.my_firm_id())
    )
  );
-- Inserts go via service role only — no client policy.

-- ── DSE assessments ─────────────────────────────────────────
create table if not exists public.hr_dse_assessments (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references public.firms on delete cascade,
  user_id uuid not null references public.users on delete cascade,
  assessment_date date not null,
  assessor_id uuid references public.users on delete set null,
  responses jsonb,                   -- structured answers; UI defines the shape
  recommendations text,
  next_review_date date,
  created_at timestamptz not null default now()
);
create index if not exists hr_dse_user_idx on public.hr_dse_assessments (user_id, assessment_date desc);
alter table public.hr_dse_assessments enable row level security;
create policy "hr_dse: read self/manager/admin"
  on public.hr_dse_assessments for select
  using (
    firm_id = public.my_firm_id() and (
      user_id = auth.uid()
      or exists (select 1 from public.users u where u.id = user_id and u.manager_id = auth.uid())
      or exists (select 1 from public.users where id = auth.uid() and role = 'admin' and firm_id = public.my_firm_id())
    )
  );
create policy "hr_dse: write self/admin"
  on public.hr_dse_assessments for all
  using (
    firm_id = public.my_firm_id() and (
      user_id = auth.uid()
      or exists (select 1 from public.users where id = auth.uid() and role = 'admin' and firm_id = public.my_firm_id())
    )
  )
  with check (
    firm_id = public.my_firm_id() and (
      user_id = auth.uid()
      or exists (select 1 from public.users where id = auth.uid() and role = 'admin' and firm_id = public.my_firm_id())
    )
  );

-- ── TOIL records (positive earned, negative used) ───────────
create table if not exists public.hr_toil_records (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references public.firms on delete cascade,
  user_id uuid not null references public.users on delete cascade,
  amount_hours numeric not null,     -- positive = earned, negative = used
  date_recorded date not null,
  reason text,
  approved_by uuid references public.users on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists hr_toil_user_idx on public.hr_toil_records (firm_id, user_id, date_recorded desc);
alter table public.hr_toil_records enable row level security;
create policy "hr_toil: read self/manager/admin"
  on public.hr_toil_records for select
  using (
    firm_id = public.my_firm_id() and (
      user_id = auth.uid()
      or exists (select 1 from public.users u where u.id = user_id and u.manager_id = auth.uid())
      or exists (select 1 from public.users where id = auth.uid() and role = 'admin' and firm_id = public.my_firm_id())
    )
  );
create policy "hr_toil: manager/admin write"
  on public.hr_toil_records for all
  using (
    firm_id = public.my_firm_id() and (
      exists (select 1 from public.users u where u.id = user_id and u.manager_id = auth.uid())
      or exists (select 1 from public.users where id = auth.uid() and role = 'admin' and firm_id = public.my_firm_id())
    )
  )
  with check (
    firm_id = public.my_firm_id() and (
      exists (select 1 from public.users u where u.id = user_id and u.manager_id = auth.uid())
      or exists (select 1 from public.users where id = auth.uid() and role = 'admin' and firm_id = public.my_firm_id())
    )
  );

-- ── Leaver workflow ─────────────────────────────────────────
create table if not exists public.hr_leavers (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references public.firms on delete cascade,
  user_id uuid not null references public.users on delete cascade,
  notice_given_date date,
  last_working_date date,
  reason text check (reason in ('resigned', 'redundancy', 'dismissal', 'retired', 'end_of_contract', 'other')),
  exit_interview_done boolean not null default false,
  exit_interview_notes text,
  equipment_returned boolean not null default false,
  systems_offboarded boolean not null default false,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (firm_id, user_id)
);
alter table public.hr_leavers enable row level security;
-- Admins manage; the leaver themselves can see their own record (for transparency)
create policy "hr_leavers: read self or admin"
  on public.hr_leavers for select
  using (
    firm_id = public.my_firm_id() and (
      user_id = auth.uid()
      or exists (select 1 from public.users where id = auth.uid() and role = 'admin' and firm_id = public.my_firm_id())
    )
  );
create policy "hr_leavers: admin write"
  on public.hr_leavers for all
  using (firm_id = public.my_firm_id() and exists (select 1 from public.users where id = auth.uid() and role = 'admin'))
  with check (firm_id = public.my_firm_id() and exists (select 1 from public.users where id = auth.uid() and role = 'admin'));
