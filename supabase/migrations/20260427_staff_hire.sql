-- Staff Hire module tables
-- Job postings, applicants, interview questions, scorecards, and per-user access control

-- ─── Job Postings ─────────────────────────────────────────────────────────────
create table if not exists job_postings (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid references firms(id) on delete cascade not null,
  created_by uuid references users(id) on delete set null,

  -- Basic details
  title text not null,
  employment_type text not null check (employment_type in ('full_time', 'part_time', 'contract')),
  location_type text not null check (location_type in ('in_office', 'remote', 'hybrid')),
  location text,

  -- Compensation
  salary_from int, -- annual salary in whole GBP
  salary_to int,   -- annual salary in whole GBP
  salary_display text, -- e.g. "£30,000 – £35,000 per annum"
  benefits text,

  -- Requirements
  experience_years_min int,
  requirements jsonb default '[]'::jsonb,
  -- each item: { label: string, category: string, mandatory: boolean, notes: string }

  -- Content
  description text,
  generated_posting text, -- AI-generated job posting text

  -- Status
  status text not null default 'active' check (status in ('draft', 'active', 'closed')),
  applicant_count int not null default 0,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ─── Applicants ───────────────────────────────────────────────────────────────
create table if not exists job_applicants (
  id uuid primary key default gen_random_uuid(),
  job_id uuid references job_postings(id) on delete cascade not null,
  firm_id uuid references firms(id) on delete cascade not null,
  added_by uuid references users(id) on delete set null,

  -- Personal details
  full_name text not null,
  email text,
  phone text,

  -- Pipeline stage
  stage text not null default 'applied'
    check (stage in ('applied', 'shortlisted', 'interview_scheduled', 'interviewed', 'offered', 'hired', 'rejected')),

  -- Documents (stored in Supabase Storage)
  cv_storage_path text,
  cv_filename text,
  cover_letter_storage_path text,
  cover_letter_filename text,

  -- AI evaluation results
  ai_evaluation jsonb,     -- full structured evaluation object
  ai_score numeric(5,2),   -- 0–100 overall score
  ai_summary text,         -- short AI summary paragraph
  ranking_position int,    -- set by AI ranking endpoint

  -- User notes
  notes text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ─── Interview Questions ───────────────────────────────────────────────────────
create table if not exists applicant_questions (
  id uuid primary key default gen_random_uuid(),
  applicant_id uuid references job_applicants(id) on delete cascade not null,
  job_id uuid references job_postings(id) on delete cascade not null,
  firm_id uuid references firms(id) on delete cascade not null,

  questions jsonb not null default '[]'::jsonb,
  -- each item: { question, category, rationale, followUp }

  generated_at timestamptz not null default now()
);

-- ─── Scorecards ───────────────────────────────────────────────────────────────
create table if not exists applicant_scorecards (
  id uuid primary key default gen_random_uuid(),
  applicant_id uuid references job_applicants(id) on delete cascade not null,
  firm_id uuid references firms(id) on delete cascade not null,

  criteria jsonb not null default '[]'::jsonb,
  -- each item: { category, criterion, description, weight, score, notes }

  overall_score numeric(5,2),
  recommendation text,       -- AI-suggested hire recommendation
  interviewer_notes text,    -- free text from the interviewer
  completed_at timestamptz,  -- set when interviewer marks scorecard complete

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ─── Per-user access ──────────────────────────────────────────────────────────
-- Admins always have access; staff users must be explicitly granted access
create table if not exists staff_hire_access (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid references firms(id) on delete cascade not null,
  user_id uuid references users(id) on delete cascade not null,
  granted_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (firm_id, user_id)
);

-- ─── Indexes ──────────────────────────────────────────────────────────────────
create index if not exists idx_job_postings_firm_id on job_postings(firm_id);
create index if not exists idx_job_applicants_job_id on job_applicants(job_id);
create index if not exists idx_job_applicants_firm_id on job_applicants(firm_id);
create index if not exists idx_applicant_questions_applicant_id on applicant_questions(applicant_id);
create index if not exists idx_applicant_scorecards_applicant_id on applicant_scorecards(applicant_id);
create index if not exists idx_staff_hire_access_firm_user on staff_hire_access(firm_id, user_id);

-- ─── RLS ──────────────────────────────────────────────────────────────────────
alter table job_postings enable row level security;
alter table job_applicants enable row level security;
alter table applicant_questions enable row level security;
alter table applicant_scorecards enable row level security;
alter table staff_hire_access enable row level security;

-- All data scoped to the user's firm (API routes use service key + enforce firm_id)
create policy "firm_isolation_job_postings"
  on job_postings for all
  using (
    firm_id in (
      select firm_id from users where id = auth.uid()
    )
  );

create policy "firm_isolation_job_applicants"
  on job_applicants for all
  using (
    firm_id in (
      select firm_id from users where id = auth.uid()
    )
  );

create policy "firm_isolation_applicant_questions"
  on applicant_questions for all
  using (
    firm_id in (
      select firm_id from users where id = auth.uid()
    )
  );

create policy "firm_isolation_applicant_scorecards"
  on applicant_scorecards for all
  using (
    firm_id in (
      select firm_id from users where id = auth.uid()
    )
  );

create policy "firm_isolation_staff_hire_access"
  on staff_hire_access for all
  using (
    firm_id in (
      select firm_id from users where id = auth.uid()
    )
  );

-- ─── updated_at trigger ───────────────────────────────────────────────────────
create or replace function update_updated_at_column()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger trg_job_postings_updated_at
  before update on job_postings
  for each row execute function update_updated_at_column();

create trigger trg_job_applicants_updated_at
  before update on job_applicants
  for each row execute function update_updated_at_column();

create trigger trg_applicant_scorecards_updated_at
  before update on applicant_scorecards
  for each row execute function update_updated_at_column();
