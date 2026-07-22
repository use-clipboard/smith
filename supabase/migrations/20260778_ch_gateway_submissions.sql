-- Companies House XML Gateway — accounts submission log + submission-number sequence.
--
-- Accounts Studio files statutory accounts (iXBRL) to Companies House over the
-- XML Gateway. Companies House require, per presenter:
--   • a UNIQUE, INCREMENTAL submission number on every attempt (a reused or
--     out-of-order number is rejected immediately), and
--   • a unique numeric TransactionID in the GovTalk envelope (also used as the
--     nonce in the CHMD5 authentication hash).
--
-- We satisfy both from ONE monotonic sequence so numbers can never repeat or go
-- backwards across concurrent submissions. Every attempt — including rejections —
-- consumes a number (the number is spent the moment it is sent).
--
-- This table is the audit log of what was filed: one row per submission attempt,
-- with the raw gateway response so a rejection's errors are inspectable.

-- Monotonic source of submission / transaction numbers. Shared across the firm's
-- test and (later) live presenter accounts; strictly increasing is all Companies
-- House require. Starts at 1 for the fresh test presenter.
create sequence if not exists public.ch_gateway_submission_seq as bigint start with 1;

-- Atomic allocator — SECURITY DEFINER so the anon/auth role can draw the next
-- value without direct sequence privileges.
create or replace function public.next_ch_submission_number()
returns bigint
language sql
security definer
set search_path = public
as $$
  select nextval('public.ch_gateway_submission_seq');
$$;

create table if not exists public.ch_gateway_submissions (
  id uuid primary key default gen_random_uuid(),

  firm_id uuid not null references public.firms(id) on delete cascade,
  -- The Accounts Studio engagement this filing came from (text id; engagements
  -- live in accounts_studio_engagements). Kept nullable so a submission log row
  -- survives if the engagement is later deleted.
  engagement_id uuid references public.accounts_studio_engagements(id) on delete set null,
  client_id uuid references public.clients(id) on delete set null,

  -- Numbers sent to Companies House (from ch_gateway_submission_seq).
  submission_number bigint not null,
  transaction_id text not null,

  -- Filing identity, captured at submission time for the audit trail.
  company_number text not null,
  company_name text not null,
  -- true = test submission (GatewayTest flag 1). Test and live are separate
  -- presenter accounts; this records which environment the attempt hit.
  is_test boolean not null default true,

  -- Outcome. 'submitted' = accepted by the gateway for processing (ack received);
  -- 'rejected' = gateway/schema/business rejection; 'error' = transport failure.
  status text not null default 'submitted'
    check (status in ('submitted', 'accepted', 'rejected', 'error')),
  -- GovTalk CorrelationID returned on acknowledgement — needed to poll status.
  correlation_id text,
  gateway_status_code int,
  -- Raw GovTalk response XML (so rejection reasons are always inspectable) and a
  -- friendly extracted message. The submitted iXBRL is kept for audit/re-file.
  gateway_response text,
  error_message text,
  ixbrl text,

  submitted_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists idx_ch_gateway_submissions_engagement
  on public.ch_gateway_submissions(engagement_id, created_at desc);
create index if not exists idx_ch_gateway_submissions_firm
  on public.ch_gateway_submissions(firm_id, created_at desc);

alter table public.ch_gateway_submissions enable row level security;

-- Members of the owning firm can read the log.
create policy "ch_gateway_submissions firm read"
  on public.ch_gateway_submissions for select
  using (firm_id in (select firm_id from public.users where id = auth.uid()));

-- Writes go through the service-role submit route, but scope an insert policy to
-- the firm for defence in depth.
create policy "ch_gateway_submissions firm write"
  on public.ch_gateway_submissions for all
  using (firm_id in (select firm_id from public.users where id = auth.uid()))
  with check (firm_id in (select firm_id from public.users where id = auth.uid()));
