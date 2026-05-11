-- ============================================================
--  Proposals — Phase B: onboarding forms + responses
-- ============================================================
--  Admins build one or more onboarding forms in Settings → Proposals.
--  Each form can be scoped to a client type and / or specific services.
--  When a prospect accepts a proposal, they're sent a follow-up email
--  with a link to the matching onboarding form. Submitting the form
--  graduates the prospect to a client (optionally) and fires the
--  configured side-effects (save answers, create AML, create tasks, LOE).
-- ============================================================

create table if not exists public.proposal_onboarding_forms (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references public.firms on delete cascade,
  name text not null,
  description text,
  -- Targeting: which client type this form applies to (null = any)
  client_type text check (client_type in (
    'sole_trader','limited_company','llp','partnership','charity','trust','individual','other'
  )),
  -- Targeting: optional list of service ids — if non-empty, the form only
  -- applies when the accepted proposal includes at least one of these services.
  service_filter uuid[],
  is_default boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists onboarding_forms_firm_idx on public.proposal_onboarding_forms (firm_id, active);
alter table public.proposal_onboarding_forms enable row level security;
create policy "onboarding forms: same firm read"
  on public.proposal_onboarding_forms for select using (firm_id = public.my_firm_id());
create policy "onboarding forms: admin write"
  on public.proposal_onboarding_forms for all
  using (firm_id = public.my_firm_id() and exists (select 1 from public.users where id = auth.uid() and role = 'admin'))
  with check (firm_id = public.my_firm_id() and exists (select 1 from public.users where id = auth.uid() and role = 'admin'));

create table if not exists public.proposal_onboarding_form_fields (
  id uuid primary key default gen_random_uuid(),
  form_id uuid not null references public.proposal_onboarding_forms on delete cascade,
  -- Stable machine-readable key used as the answer JSON object key
  field_key text not null,
  label text not null,
  field_type text not null check (field_type in (
    'text','textarea','email','phone','date','number','select','checkbox','radio','file','section_header','info'
  )),
  required boolean not null default false,
  placeholder text,
  help_text text,
  options jsonb,
  -- Conditional visibility (simple — single condition for v1)
  show_if_field_key text,
  show_if_value text,
  -- If set, the answer will be written to clients.<column_name> when the form is submitted.
  -- Unknown columns are silently ignored so this is safe to set freely.
  client_field_mapping text,
  display_order int not null default 0,
  created_at timestamptz not null default now(),
  unique (form_id, field_key)
);
create index if not exists onboarding_fields_form_idx on public.proposal_onboarding_form_fields (form_id, display_order);
alter table public.proposal_onboarding_form_fields enable row level security;
create policy "onboarding fields: same firm read"
  on public.proposal_onboarding_form_fields for select using (
    exists (select 1 from public.proposal_onboarding_forms f where f.id = form_id and f.firm_id = public.my_firm_id())
  );
create policy "onboarding fields: admin write"
  on public.proposal_onboarding_form_fields for all
  using (
    exists (select 1 from public.proposal_onboarding_forms f where f.id = form_id and f.firm_id = public.my_firm_id())
    and exists (select 1 from public.users where id = auth.uid() and role = 'admin')
  )
  with check (
    exists (select 1 from public.proposal_onboarding_forms f where f.id = form_id and f.firm_id = public.my_firm_id())
    and exists (select 1 from public.users where id = auth.uid() and role = 'admin')
  );

create table if not exists public.proposal_onboarding_responses (
  id uuid primary key default gen_random_uuid(),
  proposal_id uuid not null references public.proposals on delete cascade unique,
  form_id uuid references public.proposal_onboarding_forms on delete set null,
  answers jsonb not null default '{}'::jsonb,
  submitted_by_name text,
  submitted_by_email text,
  submitted_at timestamptz not null default now(),
  -- Set when the auto-onboarding side-effects ran
  graduated_client_id uuid references public.clients on delete set null,
  side_effect_log jsonb              -- record of what fired (graduate, aml, tasks, etc)
);
alter table public.proposal_onboarding_responses enable row level security;
create policy "onboarding responses: same firm read"
  on public.proposal_onboarding_responses for select using (
    exists (select 1 from public.proposals p where p.id = proposal_id and p.firm_id = public.my_firm_id())
  );
-- Writes are service-role only via the public submit endpoint

-- The proposals row gets a pointer for convenience
alter table public.proposals
  add column if not exists onboarding_response_id uuid references public.proposal_onboarding_responses on delete set null;
