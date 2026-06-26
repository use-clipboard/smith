-- Firm (whole-tenant) account deletion requests.
--
-- Distinct from account_deletion_requests (which deletes a single user). A firm
-- admin requests deletion of the ENTIRE firm account — all users, clients and
-- data. Because there's no higher authority inside the firm, the request is
-- recorded and processed by SMITH (operator/support) after identity + billing
-- checks, rather than executed by an instant in-app wipe.

create table if not exists public.firm_deletion_requests (
  id                 uuid primary key default gen_random_uuid(),
  firm_id            uuid not null references public.firms(id) on delete cascade,
  requested_by       uuid references public.users(id) on delete set null,
  requested_by_email text,
  requested_by_name  text,
  firm_name          text,
  reason             text,
  status             text not null default 'pending'
                       check (status in ('pending', 'completed', 'cancelled')),
  requested_at       timestamptz not null default now(),
  completed_at       timestamptz,
  cancelled_at       timestamptz
);

-- One open (pending) firm-deletion request per firm at a time.
create unique index if not exists firm_deletion_requests_one_pending_per_firm
  on public.firm_deletion_requests (firm_id)
  where status = 'pending';

comment on table public.firm_deletion_requests is
  'Whole-firm account deletion requests raised by a firm admin. Processed by SMITH/operator after verification (not an instant in-app wipe).';

-- ── RLS ──────────────────────────────────────────────────────────────────────
alter table public.firm_deletion_requests enable row level security;

drop policy if exists fdr_select_firm_admin on public.firm_deletion_requests;
create policy fdr_select_firm_admin on public.firm_deletion_requests
  for select using (
    exists (
      select 1 from public.users u
      where u.id = auth.uid()
        and u.role = 'admin'
        and u.firm_id = firm_deletion_requests.firm_id
    )
  );
