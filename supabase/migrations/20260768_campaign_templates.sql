-- Campaigns module — reusable email templates.
--
-- A template is a saved subject + body the whole firm can start a campaign or
-- automation from. Built-in starter templates live in code
-- (lib/campaigns/starterTemplates.ts); this table holds the firm's own saved
-- ones. Firm-scoped, shared across the team by default.

create table if not exists public.campaign_templates (
  id           uuid primary key default gen_random_uuid(),
  firm_id      uuid not null references public.firms(id) on delete cascade,
  name         text not null default 'Untitled template',
  description  text not null default '',
  category     text not null default 'general',
  subject      text not null default '',
  preview_text text not null default '',
  body_html    text not null default '',
  body_font    text,
  created_by   uuid references public.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists campaign_templates_firm_idx
  on public.campaign_templates (firm_id, updated_at desc);

alter table public.campaign_templates enable row level security;
drop policy if exists campaign_templates_firm_all on public.campaign_templates;
create policy campaign_templates_firm_all on public.campaign_templates
  for all using (
    firm_id = (select u.firm_id from public.users u where u.id = auth.uid())
  ) with check (
    firm_id = (select u.firm_id from public.users u where u.id = auth.uid())
  );
