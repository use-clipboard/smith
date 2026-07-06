-- Accounts Studio — persisted engagements.
--
-- Accounts Studio previously ran on in-memory demo data (like Timesheets in
-- preview). This table makes engagements real: one row per set of statutory
-- accounts being produced. The full engagement object (stages, disclosures,
-- validations, imported trial balance, statements) lives in `data` jsonb so the
-- UI and the API agree on one model without a wide, churny column set. A few
-- fields are denormalised as columns for cheap listing / filtering / RLS.

create table if not exists public.accounts_studio_engagements (
  id          uuid primary key default gen_random_uuid(),
  firm_id     uuid not null references public.firms(id) on delete cascade,
  client_id   uuid references public.clients(id) on delete set null,
  created_by  uuid references public.users(id) on delete set null,
  -- Full Engagement object (see components/features/accounts-studio/types.ts).
  data        jsonb not null,
  published   boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists accounts_studio_engagements_firm_idx
  on public.accounts_studio_engagements (firm_id, updated_at desc);
create index if not exists accounts_studio_engagements_client_idx
  on public.accounts_studio_engagements (client_id);

comment on table public.accounts_studio_engagements is
  'Accounts Studio engagements: one row per statutory-accounts production job. Full engagement state in data jsonb; client_id/created_by/published/updated_at denormalised for listing and RLS.';

alter table public.accounts_studio_engagements enable row level security;

drop policy if exists "accounts_studio: same firm" on public.accounts_studio_engagements;
create policy "accounts_studio: same firm"
  on public.accounts_studio_engagements for all
  using (firm_id = public.my_firm_id())
  with check (firm_id = public.my_firm_id());
