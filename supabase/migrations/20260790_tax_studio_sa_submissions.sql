-- Tax Studio — legacy SA100 (GovTalk) submission receipts.
--
-- One row per SA100 online-filing attempt via the HMRC Transaction Engine,
-- storing the IRmark, the gateway CorrelationID, the outcome and the raw GovTalk
-- response so a filing is auditable. Sibling of tax_studio_submissions (which is
-- the MTD final-declaration receipts); this is the legacy XML route.

create table if not exists public.tax_studio_sa_submissions (
  id uuid primary key default gen_random_uuid(),

  firm_id uuid not null references public.firms(id) on delete cascade,
  return_id uuid references public.tax_studio_returns(id) on delete set null,
  client_id uuid references public.clients(id) on delete set null,

  tax_year text,                 -- e.g. '2025/26'
  utr text,
  irmark text,                   -- base64 IRmark transmitted in the return
  correlation_id text,           -- GovTalk CorrelationID (poll/delete key)
  is_test boolean not null default true,   -- TPVS vs production

  gateway_status text,           -- 'submitted' | 'accepted' | 'rejected' | 'error' | 'pending'
  gateway_message text,          -- human-readable status / first error
  hmrc_response text,            -- raw GovTalk response body for audit

  submitted_by uuid references public.users(id) on delete set null,
  submitted_at timestamptz not null default now()
);

create index if not exists idx_tsss_firm
  on public.tax_studio_sa_submissions(firm_id, submitted_at desc);
create index if not exists idx_tsss_return
  on public.tax_studio_sa_submissions(return_id, submitted_at desc);

alter table public.tax_studio_sa_submissions enable row level security;

create policy "tsss firm select"
  on public.tax_studio_sa_submissions for select
  using (firm_id in (select firm_id from public.users where id = auth.uid()));

create policy "tsss firm insert"
  on public.tax_studio_sa_submissions for insert
  with check (firm_id in (select firm_id from public.users where id = auth.uid()));
