-- ============================================================
--  Proposals — Internal comments + multiple stakeholder signatures
-- ============================================================

-- Internal review comments on a proposal (visible only to firm members)
create table if not exists public.proposal_comments (
  id uuid primary key default gen_random_uuid(),
  proposal_id uuid not null references public.proposals on delete cascade,
  user_id uuid references public.users on delete set null,
  author_name text,                  -- snapshot in case the user is removed
  body text not null,
  created_at timestamptz not null default now()
);
create index if not exists proposal_comments_idx on public.proposal_comments (proposal_id, created_at);
alter table public.proposal_comments enable row level security;
create policy "proposal comments: same firm read"
  on public.proposal_comments for select using (
    exists (select 1 from public.proposals p where p.id = proposal_id and p.firm_id = public.my_firm_id())
  );
create policy "proposal comments: firm write"
  on public.proposal_comments for all
  using (exists (select 1 from public.proposals p where p.id = proposal_id and p.firm_id = public.my_firm_id()))
  with check (exists (select 1 from public.proposals p where p.id = proposal_id and p.firm_id = public.my_firm_id()));

-- Allow multiple required signatories on a single proposal.
-- The existing proposal_signatures table holds the actual signed-name records;
-- proposal_required_signers holds the per-proposal list of who needs to sign.
create table if not exists public.proposal_required_signers (
  id uuid primary key default gen_random_uuid(),
  proposal_id uuid not null references public.proposals on delete cascade,
  signer_name text not null,
  signer_email text not null,
  signer_role text,                  -- e.g. "Director", "Trustee"
  display_order int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists required_signers_idx on public.proposal_required_signers (proposal_id, display_order);
alter table public.proposal_required_signers enable row level security;
create policy "required signers: same firm read"
  on public.proposal_required_signers for select using (
    exists (select 1 from public.proposals p where p.id = proposal_id and p.firm_id = public.my_firm_id())
  );
create policy "required signers: firm write"
  on public.proposal_required_signers for all
  using (exists (select 1 from public.proposals p where p.id = proposal_id and p.firm_id = public.my_firm_id()))
  with check (exists (select 1 from public.proposals p where p.id = proposal_id and p.firm_id = public.my_firm_id()));

-- Drop the proposal_id unique constraint on proposal_signatures so multiple
-- signatories can sign the same proposal. Each signature row now stands alone.
do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'proposal_signatures_proposal_id_key'
      and conrelid = 'public.proposal_signatures'::regclass
  ) then
    alter table public.proposal_signatures drop constraint proposal_signatures_proposal_id_key;
  end if;
end$$;

-- Add a link from the signature row back to the required_signer it satisfies (nullable).
alter table public.proposal_signatures
  add column if not exists required_signer_id uuid references public.proposal_required_signers on delete set null;
