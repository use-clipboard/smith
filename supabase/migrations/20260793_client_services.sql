-- Client Services — a per-client list of the services the firm provides, with an
-- (informational for now) fee + frequency, optional links to Tasks and, later,
-- to the Billing module's recurring invoices.
--
-- Two levels:
--   • firm_service_catalogue — the firm's master list of services (managed in
--     Settings by an admin). Client services are created from a catalogue item
--     (or as a one-off custom entry).
--   • client_services — one row per service on a specific client.
--
-- Writes go through the API with explicit admin checks; a permissive firm-read
-- RLS policy is all that's needed here (matches the timesheets/billing pattern).

-- ── Firm service catalogue ──────────────────────────────────────────────────
create table if not exists public.firm_service_catalogue (
  id                  uuid primary key default gen_random_uuid(),
  firm_id             uuid not null references public.firms(id) on delete cascade,
  name                text not null,
  description         text,
  icon                text,                       -- lucide icon key (see UI ICON_REGISTRY)
  default_frequency   text,                       -- monthly/quarterly/annual/yearly/weekly/bi_weekly/one_off/custom
  default_price_pence integer,                    -- optional default fee, pence, excl VAT
  default_task_type   text,                       -- for later auto-task creation (Phase 3)
  archived            boolean not null default false,
  sort_order          integer not null default 0,
  created_at          timestamptz not null default now()
);
create index if not exists firm_service_catalogue_firm_idx
  on public.firm_service_catalogue (firm_id, archived, sort_order);

comment on table public.firm_service_catalogue is
  'Firm-level catalogue of services offered; client_services are instantiated from these.';

alter table public.firm_service_catalogue enable row level security;
drop policy if exists fsc_firm_read on public.firm_service_catalogue;
create policy fsc_firm_read on public.firm_service_catalogue
  for select using (
    firm_id = (select u.firm_id from public.users u where u.id = auth.uid())
  );

-- ── Per-client services ─────────────────────────────────────────────────────
create table if not exists public.client_services (
  id                          uuid primary key default gen_random_uuid(),
  firm_id                     uuid not null references public.firms(id) on delete cascade,
  client_id                   uuid not null references public.clients(id) on delete cascade,
  catalogue_id                uuid references public.firm_service_catalogue(id) on delete set null, -- null = custom entry
  name                        text not null,
  description                 text,
  icon                        text,
  frequency                   text,               -- display frequency (as above)
  price_pence                 integer,            -- optional informational fee, pence, excl VAT
  status                      text not null default 'active'
                                check (status in ('active', 'paused', 'ended')),
  next_due                    date,               -- manual fallback; effective due is derived from linked tasks when present
  notes                       text,               -- per-service note
  linked_recurring_invoice_id uuid,               -- Phase 2 billing link (soft ref — no FK to keep modules decoupled)
  sort_order                  integer not null default 0,
  created_by                  uuid references public.users(id) on delete set null,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now()
);
create index if not exists client_services_client_idx
  on public.client_services (client_id, status, sort_order);
create index if not exists client_services_firm_idx
  on public.client_services (firm_id);

comment on table public.client_services is
  'Services the firm provides to a client. Fee is informational in Phase 1; links to tasks (tasks.service_id) and, later, to billing recurring invoices.';

alter table public.client_services enable row level security;
drop policy if exists cs_firm_read on public.client_services;
create policy cs_firm_read on public.client_services
  for select using (
    firm_id = (select u.firm_id from public.users u where u.id = auth.uid())
  );

-- ── Client-level service notes (the sidebar notes list) ─────────────────────
create table if not exists public.client_service_notes (
  id         uuid primary key default gen_random_uuid(),
  firm_id    uuid not null references public.firms(id) on delete cascade,
  client_id  uuid not null references public.clients(id) on delete cascade,
  body       text not null,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists client_service_notes_client_idx
  on public.client_service_notes (client_id, created_at desc);

alter table public.client_service_notes enable row level security;
drop policy if exists csn_firm_read on public.client_service_notes;
create policy csn_firm_read on public.client_service_notes
  for select using (
    firm_id = (select u.firm_id from public.users u where u.id = auth.uid())
  );

-- ── Link a task to a service ────────────────────────────────────────────────
-- Nullable; ON DELETE SET NULL so removing a service never destroys task rows
-- (the UI offers an explicit "delete the linked task too?" choice instead).
alter table public.tasks
  add column if not exists service_id uuid references public.client_services(id) on delete set null;
create index if not exists tasks_service_idx on public.tasks (service_id);
