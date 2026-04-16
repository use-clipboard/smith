-- Extended client fields: contact number, PAYE, VAT scheme, year end
alter table clients
  add column if not exists contact_number text,
  add column if not exists paye_reference text,
  add column if not exists paye_accounts_office_reference text,
  add column if not exists vat_submit_type text check (vat_submit_type in ('Cash', 'Accrual')),
  add column if not exists vat_scheme text check (vat_scheme in ('Monthly', 'Quarterly', 'Yearly')),
  add column if not exists year_end text;
