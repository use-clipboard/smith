-- Accounts Studio — dedicated brand logo (email header + PDF cover), separate
-- from the firm-wide firms.logo_url. Stored in a private bucket; served as a
-- data URL by the firm-settings/logo route (service-role access, so no storage
-- RLS policy is needed here).

alter table public.accounts_studio_firm_settings
  add column if not exists brand_logo_path text;

insert into storage.buckets (id, name, public)
values ('accounts-studio-branding', 'accounts-studio-branding', false)
on conflict (id) do nothing;
