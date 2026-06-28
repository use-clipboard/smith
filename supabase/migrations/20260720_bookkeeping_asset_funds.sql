-- Bookkeeping — fund tag on the asset register (charity depreciation by fund).
--
-- So a charity's depreciation and disposal journals carry the right fund, the
-- asset register gains a fund_id. Addition assets inherit it from their
-- Cost-additions split's fund; brought-forward assets are tagged when added.
-- NULL on non-charity books — no behaviour change there.

alter table public.bookkeeping_assets
  add column if not exists fund_id uuid references public.bookkeeping_funds(id) on delete set null;

create index if not exists bookkeeping_assets_fund_idx
  on public.bookkeeping_assets (fund_id) where fund_id is not null;

comment on column public.bookkeeping_assets.fund_id is
  'Charity fund this asset belongs to (NULL on non-charity books). Addition assets inherit it from the Cost-additions split''s fund; depreciation/disposal journals carry it so the per-fund SOFA reconciles.';
