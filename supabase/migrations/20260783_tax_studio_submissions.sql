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
