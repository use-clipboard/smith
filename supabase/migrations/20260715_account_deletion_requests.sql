-- Account deletion requests.
--
-- Backs the in-app "Delete my account & data" flow that honours SMITH's privacy
-- policy commitment (delete a user's personal data, incl. cached Google user
-- data, within 30 days of a verified request). A user submits a request; their
-- Google (Gmail/Calendar) connections are revoked immediately by the request
-- handler; a firm admin then completes the full account deletion.
--
-- The requester's identity is denormalised (user_email/user_name) so the audit
-- record survives after the user row itself is deleted on completion.

create table if not exists public.account_deletion_requests (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid references public.users(id) on delete set null,
  firm_id       uuid not null references public.firms(id) on delete cascade,
  user_email    text,
  user_name     text,
  reason        text,
  status        text not null default 'pending'
                  check (status in ('pending', 'completed', 'cancelled')),
  requested_at  timestamptz not null default now(),
  completed_at  timestamptz,
  completed_by  uuid references public.users(id) on delete set null,
  cancelled_at  timestamptz
);

-- One open (pending) request per user at a time.
create unique index if not exists account_deletion_requests_one_pending_per_user
  on public.account_deletion_requests (user_id)
  where status = 'pending';

create index if not exists account_deletion_requests_firm_status_idx
  on public.account_deletion_requests (firm_id, status);

comment on table public.account_deletion_requests is
  'In-app account/data deletion requests. Google connections are revoked on request; a firm admin completes the full deletion within 30 days (privacy policy commitment).';

-- ── RLS ──────────────────────────────────────────────────────────────────────
-- All writes happen server-side via the service role (which bypasses RLS).
-- These policies just allow a user to read their own requests, and an admin to
-- read their firm's, in case the table is ever queried with the user client.
alter table public.account_deletion_requests enable row level security;

drop policy if exists adr_select_own on public.account_deletion_requests;
create policy adr_select_own on public.account_deletion_requests
  for select using (user_id = auth.uid());

drop policy if exists adr_select_firm_admin on public.account_deletion_requests;
create policy adr_select_firm_admin on public.account_deletion_requests
  for select using (
    exists (
      select 1 from public.users u
      where u.id = auth.uid()
        and u.role = 'admin'
        and u.firm_id = account_deletion_requests.firm_id
    )
  );
