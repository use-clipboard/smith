-- ============================================================
--  Proposals & Onboarding tool — Phase A schema
-- ============================================================
--  Tables:
--    proposal_prospects          — prospective clients (separate from `clients`)
--    proposal_services           — firm-wide service catalogue
--    proposal_service_tiers      — per-service tiers (e.g. Bookkeeping <50tx)
--    proposal_packages           — template packages (Bronze/Silver/Gold)
--    proposal_package_items      — which services live inside a template
--    proposals                   — a quote sent to a prospect
--    proposal_offered_packages   — the 1..N package choices on a proposal
--    proposal_line_items         — concrete priced lines (snapshot at send)
--    proposal_signatures         — typed-name signature on acceptance
--    firm_proposal_settings      — per-firm preferences / toggles
-- ============================================================

-- ── Prospects ───────────────────────────────────────────────
create table if not exists public.proposal_prospects (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references public.firms on delete cascade,
  contact_name text not null,
  company_name text,
  email text not null,
  phone text,
  client_type text check (client_type in ('sole_trader','limited_company','llp','partnership','charity','trust','individual','other')),
  source text,                       -- 'referral','web','event','other'
  notes text,
  status text not null default 'active' check (status in ('active','converted','lost','archived')),
  converted_client_id uuid references public.clients on delete set null,
  converted_at timestamptz,
  created_by uuid references public.users on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists prospects_firm_idx on public.proposal_prospects (firm_id, status, created_at desc);
alter table public.proposal_prospects enable row level security;

create policy "prospects: same firm read"
  on public.proposal_prospects for select using (firm_id = public.my_firm_id());
create policy "prospects: firm members write"
  on public.proposal_prospects for all
  using (firm_id = public.my_firm_id())
  with check (firm_id = public.my_firm_id());

-- ── Service catalogue ───────────────────────────────────────
create table if not exists public.proposal_services (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references public.firms on delete cascade,
  name text not null,
  description text,
  category text,
  fee_type text not null default 'fixed' check (fee_type in ('fixed','tiered')),
  base_price numeric default 0,
  frequency text not null default 'monthly' check (frequency in ('one_off','monthly','quarterly','annual')),
  vat_treatment text not null default 'firm_default' check (vat_treatment in ('firm_default','inclusive','exclusive','exempt')),
  display_order int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists proposal_services_firm_idx on public.proposal_services (firm_id, display_order);
alter table public.proposal_services enable row level security;
create policy "services: same firm read"
  on public.proposal_services for select using (firm_id = public.my_firm_id());
create policy "services: admin write"
  on public.proposal_services for all
  using (firm_id = public.my_firm_id() and exists (select 1 from public.users where id = auth.uid() and role = 'admin'))
  with check (firm_id = public.my_firm_id() and exists (select 1 from public.users where id = auth.uid() and role = 'admin'));

-- Service tiers (only meaningful when fee_type='tiered')
create table if not exists public.proposal_service_tiers (
  id uuid primary key default gen_random_uuid(),
  service_id uuid not null references public.proposal_services on delete cascade,
  label text not null,
  price numeric not null default 0,
  frequency text not null default 'monthly' check (frequency in ('one_off','monthly','quarterly','annual')),
  display_order int not null default 0
);
create index if not exists service_tiers_idx on public.proposal_service_tiers (service_id, display_order);
alter table public.proposal_service_tiers enable row level security;
-- Inherit access via the parent service's firm_id
create policy "tiers: same firm read"
  on public.proposal_service_tiers for select using (
    exists (select 1 from public.proposal_services s where s.id = service_id and s.firm_id = public.my_firm_id())
  );
create policy "tiers: admin write"
  on public.proposal_service_tiers for all
  using (
    exists (select 1 from public.proposal_services s where s.id = service_id and s.firm_id = public.my_firm_id())
    and exists (select 1 from public.users where id = auth.uid() and role = 'admin')
  )
  with check (
    exists (select 1 from public.proposal_services s where s.id = service_id and s.firm_id = public.my_firm_id())
    and exists (select 1 from public.users where id = auth.uid() and role = 'admin')
  );

-- ── Package templates ───────────────────────────────────────
create table if not exists public.proposal_packages (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references public.firms on delete cascade,
  name text not null,
  description text,
  display_order int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists proposal_packages_firm_idx on public.proposal_packages (firm_id, display_order);
alter table public.proposal_packages enable row level security;
create policy "packages: same firm read"
  on public.proposal_packages for select using (firm_id = public.my_firm_id());
create policy "packages: admin write"
  on public.proposal_packages for all
  using (firm_id = public.my_firm_id() and exists (select 1 from public.users where id = auth.uid() and role = 'admin'))
  with check (firm_id = public.my_firm_id() and exists (select 1 from public.users where id = auth.uid() and role = 'admin'));

create table if not exists public.proposal_package_items (
  id uuid primary key default gen_random_uuid(),
  package_id uuid not null references public.proposal_packages on delete cascade,
  service_id uuid not null references public.proposal_services on delete cascade,
  tier_id uuid references public.proposal_service_tiers on delete set null,
  custom_price numeric,
  display_order int not null default 0
);
create index if not exists package_items_idx on public.proposal_package_items (package_id, display_order);
alter table public.proposal_package_items enable row level security;
create policy "package items: same firm read"
  on public.proposal_package_items for select using (
    exists (select 1 from public.proposal_packages p where p.id = package_id and p.firm_id = public.my_firm_id())
  );
create policy "package items: admin write"
  on public.proposal_package_items for all
  using (
    exists (select 1 from public.proposal_packages p where p.id = package_id and p.firm_id = public.my_firm_id())
    and exists (select 1 from public.users where id = auth.uid() and role = 'admin')
  )
  with check (
    exists (select 1 from public.proposal_packages p where p.id = package_id and p.firm_id = public.my_firm_id())
    and exists (select 1 from public.users where id = auth.uid() and role = 'admin')
  );

-- ── Proposals ───────────────────────────────────────────────
create table if not exists public.proposals (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references public.firms on delete cascade,
  prospect_id uuid not null references public.proposal_prospects on delete cascade,
  title text not null default 'Proposal',
  intro text,
  terms text,
  notes_internal text,
  vat_mode text not null default 'exclusive' check (vat_mode in ('inclusive','exclusive')),
  vat_rate numeric not null default 20,
  discount_amount numeric not null default 0,
  discount_label text,
  status text not null default 'draft' check (status in ('draft','sent','viewed','accepted','declined','expired','withdrawn')),
  public_token text unique,
  sent_at timestamptz,
  first_viewed_at timestamptz,
  last_viewed_at timestamptz,
  decided_at timestamptz,
  decline_reason text,
  expires_at timestamptz,
  -- Snapshot totals (computed at send / accept time)
  total_one_off numeric default 0,
  total_monthly numeric default 0,
  total_annual numeric default 0,
  chosen_package_id uuid,            -- references proposal_offered_packages.id when accepted
  created_by uuid references public.users on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists proposals_firm_idx on public.proposals (firm_id, status, created_at desc);
create index if not exists proposals_prospect_idx on public.proposals (prospect_id, created_at desc);
create index if not exists proposals_token_idx on public.proposals (public_token);
alter table public.proposals enable row level security;
create policy "proposals: same firm read"
  on public.proposals for select using (firm_id = public.my_firm_id());
create policy "proposals: firm write"
  on public.proposals for all
  using (firm_id = public.my_firm_id())
  with check (firm_id = public.my_firm_id());

-- Offered packages (the choices the prospect can pick from on this proposal)
create table if not exists public.proposal_offered_packages (
  id uuid primary key default gen_random_uuid(),
  proposal_id uuid not null references public.proposals on delete cascade,
  name text not null,
  description text,
  display_order int not null default 0,
  is_chosen boolean not null default false,
  total_one_off numeric default 0,
  total_monthly numeric default 0,
  total_annual numeric default 0,
  created_at timestamptz not null default now()
);
create index if not exists offered_packages_idx on public.proposal_offered_packages (proposal_id, display_order);
alter table public.proposal_offered_packages enable row level security;
create policy "offered packages: same firm read"
  on public.proposal_offered_packages for select using (
    exists (select 1 from public.proposals p where p.id = proposal_id and p.firm_id = public.my_firm_id())
  );
create policy "offered packages: firm write"
  on public.proposal_offered_packages for all
  using (exists (select 1 from public.proposals p where p.id = proposal_id and p.firm_id = public.my_firm_id()))
  with check (exists (select 1 from public.proposals p where p.id = proposal_id and p.firm_id = public.my_firm_id()));

-- Line items (snapshot of pricing at send time)
create table if not exists public.proposal_line_items (
  id uuid primary key default gen_random_uuid(),
  proposal_id uuid not null references public.proposals on delete cascade,
  offered_package_id uuid references public.proposal_offered_packages on delete cascade,
  service_id uuid references public.proposal_services on delete set null,
  service_name text not null,
  description text,
  tier_label text,
  frequency text not null default 'monthly' check (frequency in ('one_off','monthly','quarterly','annual')),
  unit_price numeric not null default 0,
  quantity numeric not null default 1,
  vat_treatment text not null default 'exclusive' check (vat_treatment in ('inclusive','exclusive','exempt')),
  display_order int not null default 0
);
create index if not exists line_items_idx on public.proposal_line_items (proposal_id, display_order);
alter table public.proposal_line_items enable row level security;
create policy "line items: same firm read"
  on public.proposal_line_items for select using (
    exists (select 1 from public.proposals p where p.id = proposal_id and p.firm_id = public.my_firm_id())
  );
create policy "line items: firm write"
  on public.proposal_line_items for all
  using (exists (select 1 from public.proposals p where p.id = proposal_id and p.firm_id = public.my_firm_id()))
  with check (exists (select 1 from public.proposals p where p.id = proposal_id and p.firm_id = public.my_firm_id()));

-- Signature on acceptance
create table if not exists public.proposal_signatures (
  id uuid primary key default gen_random_uuid(),
  proposal_id uuid not null references public.proposals on delete cascade unique,
  signer_name text not null,
  signer_email text not null,
  typed_signature text not null,
  ip_address text,
  user_agent text,
  signed_at timestamptz not null default now()
);
alter table public.proposal_signatures enable row level security;
create policy "signatures: same firm read"
  on public.proposal_signatures for select using (
    exists (select 1 from public.proposals p where p.id = proposal_id and p.firm_id = public.my_firm_id())
  );
-- writes via service role only (the public accept endpoint)

-- ── Firm-level proposal settings (one row per firm) ─────────
create table if not exists public.firm_proposal_settings (
  firm_id uuid primary key references public.firms on delete cascade,
  default_vat_mode text not null default 'exclusive' check (default_vat_mode in ('inclusive','exclusive')),
  default_vat_rate numeric not null default 20,
  intro_template text,
  terms_template text,
  default_expiry_days int default 30,
  -- Auto-onboarding side effects on acceptance
  auto_graduate_client boolean not null default true,
  auto_save_form_answers boolean not null default true,
  auto_create_aml boolean not null default false,
  auto_create_tasks boolean not null default false,
  auto_tasks_template_id uuid,
  auto_generate_loe boolean not null default false,
  -- Payment
  collect_payment_on_accept boolean not null default false,
  stripe_account_id text,
  -- Email
  email_from_address text,
  email_signature text,
  updated_at timestamptz not null default now()
);
alter table public.firm_proposal_settings enable row level security;
create policy "proposal settings: same firm read"
  on public.firm_proposal_settings for select using (firm_id = public.my_firm_id());
create policy "proposal settings: admin write"
  on public.firm_proposal_settings for all
  using (firm_id = public.my_firm_id() and exists (select 1 from public.users where id = auth.uid() and role = 'admin'))
  with check (firm_id = public.my_firm_id() and exists (select 1 from public.users where id = auth.uid() and role = 'admin'));
