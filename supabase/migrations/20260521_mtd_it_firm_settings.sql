-- MTD IT — per-firm settings: email templates + auto-reminder config.
--
-- One row per firm. Auto-created lazily on first read by the API, so admins
-- don't need a separate "create defaults" action. The Settings → MTD IT tab
-- reads + writes this row.
--
-- Templates use {{handlebars}}-style variables, e.g.:
--   {{client_name}}, {{client_code}}, {{quarter_label}}, {{tax_year_label}},
--   {{period_from}}, {{period_to}}, {{firm_name}}, {{preparer_name}},
--   {{approval_link}}
-- The render helper in lib/mtdIt/email.ts substitutes them at send time.

create table if not exists public.mtd_it_firm_settings (
  firm_id uuid primary key references public.firms(id) on delete cascade,

  -- Approval-request email (sent to the client)
  approval_email_subject text not null default
    'MTD IT — please approve {{client_name}} {{quarter_label}} {{tax_year_label}}',
  approval_email_body text not null default
    'Hi {{client_name}},

Please find attached your MTD IT quarterly figures for {{quarter_label}} of {{tax_year_label}} ({{period_from}} – {{period_to}}).

When you''re happy with the figures, please click the button below to approve them for submission to HMRC. If anything looks wrong, click Request changes instead and let us know what to amend.

Many thanks,
{{preparer_name}}
{{firm_name}}',

  -- Preparer-notification email (sent to the preparer when client approves)
  preparer_approved_subject text not null default
    'Approved — {{client_name}} ({{client_code}}) — {{quarter_label}} {{tax_year_label}}',
  preparer_approved_body text not null default
    '{{client_name}} ({{client_code}}) has approved their MTD IT figures for {{quarter_label}} of {{tax_year_label}}.

Approved at: {{approved_at}}

You can now proceed with the HMRC submission.',

  -- Preparer-notification email (sent when client requests changes)
  preparer_changes_subject text not null default
    'Changes requested — {{client_name}} ({{client_code}}) — {{quarter_label}} {{tax_year_label}}',
  preparer_changes_body text not null default
    '{{client_name}} ({{client_code}}) has reviewed their MTD IT figures for {{quarter_label}} of {{tax_year_label}} and would like changes:

"{{changes_note}}"

Submitted at: {{responded_at}}',

  -- Auto-reminder config (Vercel cron will pick up these settings).
  reminder_enabled boolean not null default false,
  reminder_days    int     not null default 7   check (reminder_days between 1 and 60),
  reminder_max     int     not null default 1   check (reminder_max  between 1 and 5),
  reminder_subject text not null default
    'Reminder — please approve {{client_name}} {{quarter_label}} {{tax_year_label}}',
  reminder_body text not null default
    'Hi {{client_name}},

Just a gentle reminder to approve the MTD IT figures we sent through for {{quarter_label}} of {{tax_year_label}}.

If you have any questions, please reply to this email.

Many thanks,
{{preparer_name}}
{{firm_name}}',

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.mtd_it_firm_settings enable row level security;

-- Firm members can read + admins can write
create policy "mtd_it_firm_settings firm read"
  on public.mtd_it_firm_settings for select
  using (firm_id in (select firm_id from public.users where id = auth.uid()));

create policy "mtd_it_firm_settings admin write"
  on public.mtd_it_firm_settings for all
  using (
    firm_id in (select firm_id from public.users where id = auth.uid() and role = 'admin')
  )
  with check (
    firm_id in (select firm_id from public.users where id = auth.uid() and role = 'admin')
  );
