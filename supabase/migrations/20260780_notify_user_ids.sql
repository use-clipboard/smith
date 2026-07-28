-- "Also notify these team members" for client approvals / change requests.
--
-- Accounts Studio and MTD IT each email + in-app-notify the accountant who sent
-- the accounts/return for approval when the client responds. This adds an
-- optional list of ADDITIONAL firm users to notify the same way — configured per
-- tool in Settings. Stored as a JSON array of user ids.

alter table public.accounts_studio_firm_settings
  add column if not exists notify_user_ids jsonb not null default '[]'::jsonb;

alter table public.mtd_it_firm_settings
  add column if not exists notify_user_ids jsonb not null default '[]'::jsonb;
