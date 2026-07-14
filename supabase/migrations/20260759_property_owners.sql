-- ============================================================
--  property_owners — richer ownership model for the shared
--  per-client property register (public.mtd_it_properties).
-- ============================================================
--  The Landlord Analysis tool lets a property be owned by
--  several people, each with a % share, so income/expenses can
--  be split per person (feeds the future self-assessment tool).
--
--  Unlike mtd_it_property_links (which requires the co-owner to
--  be a client), an owner here may be EITHER a linked client
--  (owner_client_id set — the bridge to self-assessment) OR a
--  plain named individual not yet in the system (snapshot only).
--
--  Convention (mirrors the MTD IT co-owner modal):
--    - The primary landlord's own share lives on
--      mtd_it_properties.ownership_pct.
--    - property_owners holds the ADDITIONAL co-owners.
--    Together they should sum to <= 100; a gap is allowed.
-- ============================================================

create table if not exists public.property_owners (
  id              uuid primary key default gen_random_uuid(),
  property_id     uuid not null references public.mtd_it_properties(id) on delete cascade,

  -- Set when the owner is a client record (bridge to self-assessment);
  -- null for a plain named individual not yet onboarded.
  owner_client_id uuid references public.clients(id) on delete set null,

  -- Always filled: the client's name snapshot, or the hand-typed name.
  owner_name      text not null,

  -- This owner's % of the property. 0 < x <= 100.
  share_pct       numeric(5,2) not null default 0
                  check (share_pct >= 0 and share_pct <= 100),

  created_at      timestamptz not null default now(),
  created_by      uuid references public.users(id) on delete set null
);

create index if not exists property_owners_property_idx on public.property_owners(property_id);
create index if not exists property_owners_client_idx   on public.property_owners(owner_client_id);

alter table public.property_owners enable row level security;

-- Firm members that own the property (via client -> firm) can read + write.
create policy "property_owners firm read"
  on public.property_owners for select
  using (
    property_id in (
      select p.id from public.mtd_it_properties p
      join public.clients c on c.id = p.client_id
      where c.firm_id in (select firm_id from public.users where id = auth.uid())
    )
  );

create policy "property_owners firm write"
  on public.property_owners for all
  using (
    property_id in (
      select p.id from public.mtd_it_properties p
      join public.clients c on c.id = p.client_id
      where c.firm_id in (select firm_id from public.users where id = auth.uid())
    )
  )
  with check (
    property_id in (
      select p.id from public.mtd_it_properties p
      join public.clients c on c.id = p.client_id
      where c.firm_id in (select firm_id from public.users where id = auth.uid())
    )
  );
