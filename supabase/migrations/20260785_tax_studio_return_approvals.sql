-- Tax Studio — client-approval records for SA100 returns.
--
-- One tokened row per approval request (mirrors accounts_studio_approvals, plus
-- the typed-name e-signature). The public /tax-studio/approve/{token} portal
-- reads/writes this via the service role — the token is the access, so there is
-- no anon RLS policy.

create table if not exists public.tax_studio_return_approvals (
  id uuid primary key default gen_random_uuid(),

  return_id uuid references public.tax_studio_returns(id) on delete cascade,
  firm_id uuid not null references public.firms(id) on delete cascade,

  token text not null unique,
  sent_by uuid references public.users(id) on delete set null,
  sent_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '30 days'),
  recipient_email text,
  cover_note text,

  approved_at timestamptz,
  approved_by_name text,           -- typed-name e-signature
  changes_requested_at timestamptz,
  changes_note text,

  responded_ip text,
  responded_user_agent text,
  voided_at timestamptz,

  created_at timestamptz not null default now()
);

create index if not exists idx_tsra_return on public.tax_studio_return_approvals(return_id, created_at desc);
create index if not exists idx_tsra_firm on public.tax_studio_return_approvals(firm_id, created_at desc);

alter table public.tax_studio_return_approvals enable row level security;

-- Firm members can read their firm's approval rows (the public portal uses the
-- service role, which bypasses RLS).
create policy "tsra firm select"
  on public.tax_studio_return_approvals for select
  using (firm_id in (select firm_id from public.users where id = auth.uid()));

create policy "tsra firm insert"
  on public.tax_studio_return_approvals for insert
  with check (firm_id in (select firm_id from public.users where id = auth.uid()));
