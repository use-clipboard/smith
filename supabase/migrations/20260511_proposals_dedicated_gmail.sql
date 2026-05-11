-- ============================================================
--  Proposals — dedicated Gmail connection + custom subject lines
-- ============================================================
--  A separate `proposal_email_connections` table so a firm can link
--  a Gmail account just for proposals (e.g. hello@firm.co.uk),
--  without it interfering with each staff member's personal Gmail
--  used in Email Triage.
-- ============================================================

create table if not exists public.proposal_email_connections (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references public.firms on delete cascade,
  connected_by_user_id uuid references public.users on delete set null,
  google_email text not null,
  display_name text,                 -- optional label like "Proposals inbox"
  access_token text,
  refresh_token text not null,
  token_expiry timestamptz,
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (firm_id, google_email)
);
create index if not exists proposal_email_connections_firm_idx
  on public.proposal_email_connections (firm_id);
alter table public.proposal_email_connections enable row level security;
create policy "proposal email connections: same firm read"
  on public.proposal_email_connections for select
  using (firm_id = public.my_firm_id());
-- Writes via service role only (the callback)

-- Replace user_id pointer with a connection_id pointer
alter table public.firm_proposal_settings
  add column if not exists proposal_email_sender_connection_id uuid
    references public.proposal_email_connections on delete set null;

-- Custom subject lines (with merge tags {firm}, {prospect_name}, {proposal_title})
alter table public.firm_proposal_settings
  add column if not exists subject_proposal text,
  add column if not exists subject_reminder text,
  add column if not exists subject_onboarding text;

-- For "Send a test email" we store a sample/preview proposal id so we can
-- reuse the same draft instead of polluting the dashboard with N duplicates.
alter table public.firm_proposal_settings
  add column if not exists preview_proposal_id uuid
    references public.proposals on delete set null;
