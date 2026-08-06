-- ============================================================================
-- Tax Studio — combined migration apply.
-- Paste this WHOLE file once into the Supabase SQL editor (live project) and run.
-- Idempotent (create table if not exists / create policy) — safe to re-run,
-- though re-running after success will error on the CREATE POLICY lines because
-- policies have no IF NOT EXISTS; that's harmless (means they already exist).
-- Generated from supabase/migrations/20260782_tax_studio.sql + 20260783_tax_studio_submissions.sql
-- ============================================================================

-- ─────────────── 20260782_tax_studio.sql ───────────────
-- Tax Studio — returns store + audit trail.
--
-- Tax Studio prepares, reviews, plans and files HMRC returns. Like Accounts
-- Studio, each return is a large, evolving object stored verbatim in a jsonb
-- `data` column so the UI shape can change without a migration. RLS scopes
-- every row to the owning firm.

-- ── Returns ──────────────────────────────────────────────────────────────────
create table if not exists public.tax_studio_returns (
  id uuid primary key default gen_random_uuid(),

  firm_id uuid not null references public.firms(id) on delete cascade,
  client_id uuid references public.clients(id) on delete set null,
  created_by uuid references public.users(id) on delete set null,

  -- The whole TaxReturn object (see components/features/tax-studio/types.ts).
  data jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_tsr_firm
  on public.tax_studio_returns(firm_id, updated_at desc);
create index if not exists idx_tsr_client
  on public.tax_studio_returns(client_id);

alter table public.tax_studio_returns enable row level security;

create policy "tsr firm select"
  on public.tax_studio_returns for select
  using (firm_id in (select firm_id from public.users where id = auth.uid()));

create policy "tsr firm insert"
  on public.tax_studio_returns for insert
  with check (firm_id in (select firm_id from public.users where id = auth.uid()));

create policy "tsr firm update"
  on public.tax_studio_returns for update
  using (firm_id in (select firm_id from public.users where id = auth.uid()))
  with check (firm_id in (select firm_id from public.users where id = auth.uid()));

create policy "tsr firm delete"
  on public.tax_studio_returns for delete
  using (firm_id in (select firm_id from public.users where id = auth.uid()));

-- ── Audit trail ──────────────────────────────────────────────────────────────
-- Append-only history of everything done in Tax Studio. Tax filing is a
-- regulated activity, so the firm needs a durable, admin-visible record. Writes
-- go through the service-role client in a best-effort helper; reads are
-- admin-only within the firm.
create table if not exists public.tax_studio_audit_log (
  id uuid primary key default gen_random_uuid(),

  firm_id uuid not null references public.firms(id) on delete cascade,
  -- Nullable + kept after the return is deleted (client_name denormalised).
  return_id uuid references public.tax_studio_returns(id) on delete set null,
  client_id uuid references public.clients(id) on delete set null,
  client_name text,

  actor_id uuid references public.users(id) on delete set null,

  -- created | edited | analysed | reviewed | sent | approved | submitted |
  -- deleted | copied
  action text not null,
  summary text,

  created_at timestamptz not null default now()
);

create index if not exists idx_tsal_firm
  on public.tax_studio_audit_log(firm_id, created_at desc);
create index if not exists idx_tsal_return
  on public.tax_studio_audit_log(return_id, created_at desc);

alter table public.tax_studio_audit_log enable row level security;

create policy "tsal admin read"
  on public.tax_studio_audit_log for select
  using (firm_id in (select firm_id from public.users where id = auth.uid() and role = 'admin'));

create policy "tsal firm insert"
  on public.tax_studio_audit_log for insert
  with check (firm_id in (select firm_id from public.users where id = auth.uid()));


-- ─────────────── 20260783_tax_studio_submissions.sql ───────────────
-- Tax Studio — HMRC submission receipts.
--
-- One row per HMRC ITSA final-declaration (crystallisation) attempt for a
-- return, storing the calculation id, the response and status so a filing is
-- auditable. Unlike mtd_it_submissions this is not quarter-bound.

create table if not exists public.tax_studio_submissions (
  id uuid primary key default gen_random_uuid(),

  firm_id uuid not null references public.firms(id) on delete cascade,
  return_id uuid references public.tax_studio_returns(id) on delete set null,
  client_id uuid references public.clients(id) on delete set null,

  tax_year text,                 -- HMRC format, e.g. '2025-26'
  return_type text,              -- e.g. 'sa100'
  calculation_id text,           -- HMRC calculationId that was declared
  nino text,
  is_test boolean not null default true,   -- sandbox vs production

  hmrc_status int,               -- HTTP status of the final-declaration call
  hmrc_response jsonb,           -- receipt / error body

  submitted_by uuid references public.users(id) on delete set null,
  submitted_at timestamptz not null default now()
);

create index if not exists idx_tss_firm
  on public.tax_studio_submissions(firm_id, submitted_at desc);
create index if not exists idx_tss_return
  on public.tax_studio_submissions(return_id, submitted_at desc);

alter table public.tax_studio_submissions enable row level security;

-- Read: any member of the owning firm.
create policy "tss firm select"
  on public.tax_studio_submissions for select
  using (firm_id in (select firm_id from public.users where id = auth.uid()));

-- Insert: any member of the owning firm (writes go via the service role, but
-- scope defence-in-depth to the caller's firm).
create policy "tss firm insert"
  on public.tax_studio_submissions for insert
  with check (firm_id in (select firm_id from public.users where id = auth.uid()));
