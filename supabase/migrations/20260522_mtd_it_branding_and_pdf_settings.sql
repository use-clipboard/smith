-- MTD IT — branding + PDF content toggles + logo storage bucket.
--
-- Adds:
--   brand_primary_color           hex string used by PDF header band + email header
--   brand_logo_path               supabase storage key (under mtd-it-branding bucket)
--   pdf_include_*                 per-section toggles for the PDF generator
--   pdf_include_quarterly_comparison drives the Q1-Q4 comparison table on the
--                                 PDF cover page
--
-- Also creates the mtd-it-branding storage bucket (private).

alter table public.mtd_it_firm_settings
  add column if not exists brand_primary_color text not null default '#8B85CF'
    check (brand_primary_color ~ '^#[0-9a-fA-F]{6}$'),
  add column if not exists brand_logo_path text,
  add column if not exists pdf_include_kpi_cards            boolean not null default true,
  add column if not exists pdf_include_chart                boolean not null default true,
  add column if not exists pdf_include_category_tables      boolean not null default true,
  add column if not exists pdf_include_breakdown            boolean not null default true,
  add column if not exists pdf_include_transaction_detail   boolean not null default true,
  add column if not exists pdf_include_quarterly_comparison boolean not null default true;

-- Private storage bucket for firm logos (one file per firm, e.g. "{firm_id}/logo.png").
insert into storage.buckets (id, name, public)
values ('mtd-it-branding', 'mtd-it-branding', false)
on conflict (id) do nothing;
