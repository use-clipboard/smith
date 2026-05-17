-- MTD IT — co-owned property links.
--
-- A husband and wife who jointly own a rental property each appear as a
-- separate MTD IT client (HMRC requires per-individual reporting), but
-- they share the *same property*. This table records that relationship
-- as a directed edge: "client X's property P is co-owned with client Y,
-- who has share C".
--
-- The link is always created in pairs (one row per direction) so both
-- clients see the same co-ownership structure when they open MTD IT.
-- API helpers maintain that invariant.
--
-- Each link encodes the OTHER side's share — i.e. the row attached to
-- A's property records B's share. A's own share lives on the property
-- row itself (mtd_it_properties.share_pct). Together they sum to <= 100;
-- gaps (e.g. 60 + 30 = 90, missing 10%) are allowed because the firm
-- might not be doing every co-owner.

create table if not exists public.mtd_it_property_links (
  id uuid primary key default gen_random_uuid(),

  -- This client's property row (the "from" side of the directed edge)
  property_id uuid not null references public.mtd_it_properties(id) on delete cascade,

  -- The co-owner (a separate MTD IT client in the same firm)
  co_owner_client_id uuid not null references public.clients(id) on delete cascade,

  -- The co-owner's % of the property. 0 < x <= 100.
  co_owner_share_pct numeric(5,2) not null check (co_owner_share_pct > 0 and co_owner_share_pct <= 100),

  created_at timestamptz not null default now(),
  created_by uuid references public.users(id) on delete set null,

  -- One link row per (property, co-owner) pair.
  unique (property_id, co_owner_client_id)
);

-- Look-ups by either side
create index if not exists idx_mtd_it_property_links_property  on public.mtd_it_property_links(property_id);
create index if not exists idx_mtd_it_property_links_co_owner  on public.mtd_it_property_links(co_owner_client_id);

alter table public.mtd_it_property_links enable row level security;

-- Members of the firm that owns the property can read + write links.
create policy "mtd_it_property_links firm read"
  on public.mtd_it_property_links for select
  using (
    property_id in (
      select p.id from public.mtd_it_properties p
      join public.clients c on c.id = p.client_id
      where c.firm_id in (select firm_id from public.users where id = auth.uid())
    )
  );

create policy "mtd_it_property_links firm write"
  on public.mtd_it_property_links for all
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
