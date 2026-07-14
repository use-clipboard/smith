-- ============================================================
--  Landlord Analysis — client approval (wizard step 5)
-- ============================================================
--  Mirrors the MTD IT approval cycle:
--    landlord_firm_settings  — per-firm email templates + brand colour
--    landlord_approvals      — one row per Send-to-client event
--
--  A Landlord analysis is persisted as an `outputs` row (feature =
--  'landlord_analysis'), so approvals hang off output_id.
--
--  The report can be sent as ONE combined computation (person_key null) or as
--  a per-individual report (one row per person, person_key set) — so each
--  owner approves their own figures and we can show "2 of 3 approved".
-- ============================================================

-- ── Per-firm settings (templates) ───────────────────────────
-- One row per firm, lazily created on first read. Templates use
-- {{handlebars}} variables: {{client_name}}, {{client_code}}, {{period_from}},
-- {{period_to}}, {{firm_name}}, {{preparer_name}}, {{person_name}},
-- {{approval_link}}. The logo comes from the firm-wide branding
-- (/api/firm/branding), the same source the PDF already uses.
create table if not exists public.landlord_firm_settings (
  firm_id uuid primary key references public.firms(id) on delete cascade,

  approval_email_subject text not null default
    'Property income computation for approval — {{client_name}} ({{period_from}} to {{period_to}})',
  approval_email_body text not null default
    'Hi {{person_name}},

Please find attached your property income computation for the period {{period_from}} to {{period_to}}.

When you''re happy with the figures, please click the button below to approve them. If anything looks wrong, click Request changes instead and let us know what to amend.

Many thanks,
{{preparer_name}}
{{firm_name}}',

  preparer_approved_subject text not null default
    'Approved — {{client_name}} ({{client_code}}) property income computation',
  preparer_approved_body text not null default
    '{{person_name}} has approved the property income computation for {{client_name}} ({{client_code}}) covering {{period_from}} to {{period_to}}.

Approved at: {{approved_at}}',

  preparer_changes_subject text not null default
    'Changes requested — {{client_name}} ({{client_code}}) property income computation',
  preparer_changes_body text not null default
    '{{person_name}} has reviewed the property income computation for {{client_name}} ({{client_code}}) and would like changes:

"{{changes_note}}"

Submitted at: {{responded_at}}',

  -- Drives the email header band (and matches the PDF accent).
  brand_primary_color text not null default '#8B85CF',

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.landlord_firm_settings enable row level security;

create policy "landlord_firm_settings firm read"
  on public.landlord_firm_settings for select
  using (firm_id in (select firm_id from public.users where id = auth.uid()));

create policy "landlord_firm_settings admin write"
  on public.landlord_firm_settings for all
  using (firm_id in (select firm_id from public.users where id = auth.uid() and role = 'admin'))
  with check (firm_id in (select firm_id from public.users where id = auth.uid() and role = 'admin'));

-- ── Approval cycles ─────────────────────────────────────────
-- History is kept (a re-send voids the prior pending row rather than updating
-- it in place) so the audit trail stays complete.
create table if not exists public.landlord_approvals (
  id                   uuid primary key default gen_random_uuid(),
  output_id            uuid not null references public.outputs(id) on delete cascade,

  -- Public access token used in /landlord/approve/[token]. Opaque, not a JWT.
  token                text not null unique,

  -- Null  = the combined computation for the whole portfolio.
  -- Set   = a per-individual report; matches the person key used by the
  --         per-person matrix (client id, or `name:<lowercased>` when the
  --         owner isn't a client).
  person_key           text,
  person_name          text,

  sent_by              uuid references public.users(id) on delete set null,
  sent_at              timestamptz not null default now(),
  expires_at           timestamptz not null default (now() + interval '30 days'),
  recipient_email      text not null,
  cover_note           text,

  -- Exactly one of these is set once the client responds; both null = pending.
  approved_at          timestamptz,
  changes_requested_at timestamptz,
  changes_note         text,

  responded_ip         text,
  responded_user_agent text,

  -- Set when superseded by a newer Send, so we know which row is active.
  voided_at            timestamptz,

  created_at           timestamptz not null default now()
);

create index if not exists landlord_approvals_output_idx on public.landlord_approvals(output_id);
create unique index if not exists landlord_approvals_token_idx on public.landlord_approvals(token);

alter table public.landlord_approvals enable row level security;

-- Firm members can read + manage approvals for their firm's analyses. The
-- public approval page goes through service-role, so there is deliberately no
-- anon policy.
create policy "firm_access_landlord_approvals"
  on public.landlord_approvals for all
  using (output_id in (
    select id from public.outputs
    where firm_id in (select firm_id from public.users where id = auth.uid())
  ));
