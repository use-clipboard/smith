-- ============================================================
--  Proposals — Branding fields on firm_proposal_settings
-- ============================================================
--  Lets each firm customise the look of the public proposal page:
--  logo source (firm logo, override URL, or uploaded image), optional
--  banner header image, primary + accent colours, font family, and
--  a footer text snippet.
-- ============================================================

alter table public.firm_proposal_settings
  add column if not exists brand_use_firm_logo boolean not null default true,
  add column if not exists brand_logo_url text,
  add column if not exists brand_header_image_url text,
  add column if not exists brand_primary_color text not null default '#0EA5E9',
  add column if not exists brand_accent_color text not null default '#0284C7',
  add column if not exists brand_font_family text not null default 'system',
  add column if not exists brand_footer_text text,
  add column if not exists brand_show_firm_name boolean not null default true;
