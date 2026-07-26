-- Accounts Studio — audit trail.
--
-- Append-only record of everything done in the Accounts Studio tool: who did
-- what, and when. Statutory accounts production is a regulated activity, so the
-- firm needs a durable, admin-visible history for record-keeping — creations,
-- edits (with field-level diffs), deletions, copies, approvals, filings and
-- downloads.
--
-- Writes go through the service-role client in a best-effort logging helper, so
-- a logging failure can never block the underlying action. Reads are ADMIN-ONLY
-- within the firm.

create table if not exists public.accounts_studio_audit_log (
  id uuid primary key default gen_random_uuid(),

  firm_id uuid not null references public.firms(id) on delete cascade,
  -- The engagement acted on. Nullable + ON DELETE SET NULL so a deleted set's
  -- history survives (company_name is denormalised below for the same reason).
  engagement_id uuid references public.accounts_studio_engagements(id) on delete set null,
  client_id uuid references public.clients(id) on delete set null,
  company_name text,

  -- Who did it. actor_id is null for client-side actors (a client approving via
  -- a tokened link); actor_name carries their typed name in that case.
  actor_id uuid references public.users(id) on delete set null,
  actor_name text,

  -- What happened. e.g. created | edited | deleted | copied | published |
  -- sent_for_approval | client_approved | client_rejected | marked_submitted |
  -- filed_to_ch | downloaded | exported
  action text not null,
  -- Human-readable one-liner.
  summary text,
  -- Field-level diff for edits: array of { field, label, from, to }.
  changes jsonb,

  created_at timestamptz not null default now()
);

create index if not exists idx_asal_firm
  on public.accounts_studio_audit_log(firm_id, created_at desc);
create index if not exists idx_asal_engagement
  on public.accounts_studio_audit_log(engagement_id, created_at desc);

alter table public.accounts_studio_audit_log enable row level security;

-- Read: admins of the owning firm only.
create policy "asal admin read"
  on public.accounts_studio_audit_log for select
  using (firm_id in (select firm_id from public.users where id = auth.uid() and role = 'admin'));

-- Insert: any member of the owning firm (defence in depth — the logging helper
-- uses the service role, but scope the policy so a stray client insert can only
-- ever land in the caller's own firm).
create policy "asal firm insert"
  on public.accounts_studio_audit_log for insert
  with check (firm_id in (select firm_id from public.users where id = auth.uid()));
