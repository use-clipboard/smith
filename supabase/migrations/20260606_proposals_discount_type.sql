-- Allow proposals to express a discount as either a fixed amount OR a
-- percentage of the total. The existing `discount_amount` column is
-- repurposed: when `discount_type = 'percent'` it holds 0–100 instead of
-- a £ value. The public + builder UIs interpret the field based on the
-- new type column.

alter table public.proposals
  add column if not exists discount_type text not null default 'amount'
    check (discount_type in ('amount', 'percent'));

comment on column public.proposals.discount_type is
  '"amount" → discount_amount is a £ value. "percent" → discount_amount is 0-100 percent.';
