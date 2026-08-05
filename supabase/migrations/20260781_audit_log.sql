-- Generic, firm-wide audit trail shared by every tool.
--
-- One append-only table for "who did what, and when" across the app. The `tool`
-- column discriminates (it matches outputs.feature — e.g. 'landlord_analysis',
-- 'performance_analysis', 'risk_assessment', …), so each tool's admin audit
-- viewer filters to its own rows, and a firm-wide view is possible later.
--
-- Writes go through a best-effort service-role helper (lib/audit/log.ts) so a
-- logging failure never blocks the underlying action. Reads are ADMIN-ONLY.

create table if not exists public.audit_log (
  id uuid primary key default gen_random_uuid(),

  firm_id uuid not null references public.firms(id) on delete cascade,
  -- Tool discriminator (= outputs.feature where applicable).
  tool text not null,
  -- The record acted on. Nullable (e.g. a list export has no single record).
  entity_id uuid,
  -- Denormalised human label (client / company name) so history survives deletes.
  entity_label text,
  client_id uuid references public.clients(id) on delete set null,

  -- Who did it. actor_id null for client-side actors (a client via a token);
  -- actor_name carries their typed name in that case.
  actor_id uuid references public.users(id) on delete set null,
  actor_name text,

  -- created | edited | deleted | downloaded | exported | sent_for_approval |
  -- client_approved | client_rejected | …
  action text not null,
  summary text,
  changes jsonb,

  created_at timestamptz not null default now()
);

create index if not exists idx_audit_log_firm_tool
  on public.audit_log(firm_id, tool, created_at desc);
create index if not exists idx_audit_log_entity
  on public.audit_log(entity_id, created_at desc);

alter table public.audit_log enable row level security;

-- Read: admins of the owning firm only.
create policy "audit_log admin read"
  on public.audit_log for select
  using (firm_id in (select firm_id from public.users where id = auth.uid() and role = 'admin'));

-- Insert: any member of the owning firm (defence in depth — writes go via the
-- service role, but scope a stray client insert to the caller's own firm).
create policy "audit_log firm insert"
  on public.audit_log for insert
  with check (firm_id in (select firm_id from public.users where id = auth.uid()));
