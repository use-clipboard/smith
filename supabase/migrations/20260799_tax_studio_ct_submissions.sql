-- Tax Studio — CT600 (GovTalk) submission receipts.
--
-- One row per CT600 online-filing attempt via the HMRC Transaction Engine,
-- storing the IRmark, the gateway CorrelationID, the outcome and the raw GovTalk
-- response so a filing is auditable. Sibling of tax_studio_sa_submissions (the
-- legacy SA100 route).

create table if not exists public.tax_studio_ct_submissions (
  id uuid primary key default gen_random_uuid(),

  firm_id uuid not null references public.firms(id) on delete cascade,
  return_id uuid references public.tax_studio_returns(id) on delete set null,
  client_id uuid references public.clients(id) on delete set null,

  tax_year text,                 -- accounting-period label, e.g. '2025/26'
  period_start date,             -- CT600 accounting period
  period_end date,
  utr text,
  irmark text,                   -- base64 IRmark transmitted in the return
  correlation_id text,           -- GovTalk CorrelationID (poll/delete key)
  is_test boolean not null default true,   -- CT test service vs production

  gateway_status text,           -- 'submitted' | 'accepted' | 'rejected' | 'error' | 'pending'
  gateway_message text,          -- human-readable status / first error
  hmrc_response text,            -- raw GovTalk response body for audit

  submitted_by uuid references public.users(id) on delete set null,
  submitted_at timestamptz not null default now()
);

create index if not exists idx_tscs_firm
  on public.tax_studio_ct_submissions(firm_id, submitted_at desc);
create index if not exists idx_tscs_return
  on public.tax_studio_ct_submissions(return_id, submitted_at desc);

alter table public.tax_studio_ct_submissions enable row level security;

create policy "tscs firm select"
  on public.tax_studio_ct_submissions for select
  using (firm_id in (select firm_id from public.users where id = auth.uid()));

create policy "tscs firm insert"
  on public.tax_studio_ct_submissions for insert
  with check (firm_id in (select firm_id from public.users where id = auth.uid()));
