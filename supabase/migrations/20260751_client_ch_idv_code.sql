-- Companies House Identity Verification (IDV) code for individual clients.
-- Under ECCTA 2023, a verified individual (director/PSC) receives a Companies
-- House personal code they provide to companies. We record it on the client
-- so it's to hand for filings. Shown only for individuals in Key Information.
alter table public.clients
  add column if not exists ch_idv_code text;
