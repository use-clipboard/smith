-- Accounts Studio — firm-wide note defaults.
--
-- Admin-set house-style notes (accountants' report, accountant details,
-- governing body) that seed every new engagement's disclosures so the firm's
-- standard wording appears automatically. One row per firm.

create table if not exists public.accounts_studio_firm_settings (
  firm_id            uuid primary key references public.firms(id) on delete cascade,
  accountants_report text not null default '',
  accountant_details text not null default '',
  governing_body     text not null default '',
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

comment on table public.accounts_studio_firm_settings is
  'Accounts Studio firm-wide note defaults (HTML): accountants report, accountant details, governing body. Seeded into new engagements.';

alter table public.accounts_studio_firm_settings enable row level security;

drop policy if exists "accounts_studio_firm_settings: same firm" on public.accounts_studio_firm_settings;
create policy "accounts_studio_firm_settings: same firm"
  on public.accounts_studio_firm_settings for all
  using (firm_id = public.my_firm_id())
  with check (firm_id = public.my_firm_id());
