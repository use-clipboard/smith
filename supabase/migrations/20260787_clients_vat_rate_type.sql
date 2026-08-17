-- Client VAT rate type: Standard vs Flat Rate, plus the Flat Rate percentage.
--
-- Distinct from clients.vat_scheme (which records the FILING FREQUENCY —
-- Monthly/Quarterly/Yearly) and vat_submit_type (Cash/Accrual basis). This is
-- the rate basis the client's VAT is calculated on.
--
--   vat_rate_type            — 'Standard' | 'Flat Rate' | null (not set)
--   vat_flat_rate_percentage — the effective FRS % (e.g. 14.50); only
--                              meaningful when vat_rate_type = 'Flat Rate'.

alter table public.clients
  add column if not exists vat_rate_type text,
  add column if not exists vat_flat_rate_percentage numeric(5,2);

comment on column public.clients.vat_rate_type is
  'VAT rate basis: Standard or Flat Rate (null = not set). Separate from vat_scheme (filing frequency).';
comment on column public.clients.vat_flat_rate_percentage is
  'Flat Rate Scheme % (e.g. 14.50). Only meaningful when vat_rate_type = ''Flat Rate''.';
