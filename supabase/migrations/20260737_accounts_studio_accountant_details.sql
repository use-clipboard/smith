-- Accounts Studio firm settings — structured accountant name + address.
-- These feed the Company Information page and the Accountants' Report address
-- block in the statutory accounts pack (previously it fell back to the firm name).

alter table public.accounts_studio_firm_settings
  add column if not exists accountant_name    text not null default '',
  add column if not exists accountant_address text not null default '';
