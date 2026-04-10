-- ============================================================
-- SMITH — API Key & Onboarding Migration
-- ============================================================

-- Add per-firm Anthropic API key (admin-only, stored server-side)
alter table public.firms
  add column if not exists anthropic_api_key text;

-- Add onboarding tracking to users
-- Tracks whether the first-login setup guide has been shown
alter table public.users
  add column if not exists onboarding_completed boolean not null default false;

-- ============================================================
-- RLS: Only admins of the same firm can read/write the API key
-- We enforce this in the application layer (service role key
-- is used for reads; RLS blocks direct client access).
-- The column is never returned to the client — only used
-- server-side via the service role client.
-- ============================================================
