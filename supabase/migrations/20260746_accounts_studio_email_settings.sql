-- Accounts Studio — configurable client-approval email (subject + body templates
-- + brand colour). The firm logo is reused from firms.logo_url (firm-wide
-- branding), so no separate logo column here. Empty template columns fall back
-- to the built-in defaults in lib/accounts-studio/firmSettings.ts.

alter table public.accounts_studio_firm_settings
  add column if not exists approval_email_subject text not null default '',
  add column if not exists approval_email_body    text not null default '',
  add column if not exists brand_primary_color    text not null default '#4F46E5';
