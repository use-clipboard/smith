-- Accounts Studio — client approval records (mirrors mtd_it_quarter_approvals).
-- One row per "Send for approval" event (history kept; never updated in place on
-- resend — a newer send voids the prior pending row). The public approval page
-- reads/writes via the service-role client using the token; there is no anon
-- RLS policy. The engagement's own status lives in accounts_studio_engagements.data.

create table if not exists public.accounts_studio_approvals (
  id                    uuid primary key default gen_random_uuid(),
  engagement_id         uuid not null references public.accounts_studio_engagements(id) on delete cascade,
  firm_id               uuid not null references public.firms(id) on delete cascade,
  token                 text not null unique,
  sent_by               uuid references public.users(id) on delete set null,
  sent_at               timestamptz not null default now(),
  expires_at            timestamptz not null default (now() + interval '30 days'),
  recipient_email       text not null,
  cover_note            text,
  approved_at           timestamptz,
  approved_by_name      text,          -- typed-name signature captured on approval
  changes_requested_at  timestamptz,
  changes_note          text,
  responded_ip          text,
  responded_user_agent  text,
  voided_at             timestamptz,   -- superseded by a newer send
  created_at            timestamptz not null default now()
);

create index if not exists accounts_studio_approvals_engagement_idx on public.accounts_studio_approvals(engagement_id);
create index if not exists accounts_studio_approvals_token_idx on public.accounts_studio_approvals(token);

alter table public.accounts_studio_approvals enable row level security;

drop policy if exists firm_access_accounts_studio_approvals on public.accounts_studio_approvals;
create policy firm_access_accounts_studio_approvals on public.accounts_studio_approvals
  for all
  using (firm_id = public.my_firm_id())
  with check (firm_id = public.my_firm_id());
