-- ============================================================
--  Proposals — per-kind email body templates
-- ============================================================
--  intro_template was already used for the Proposal delivery body.
--  Add matching fields so reminder and onboarding emails can also
--  carry firm-specific copy edited from Settings → Proposals → Email.
-- ============================================================

alter table public.firm_proposal_settings
  add column if not exists body_reminder text,
  add column if not exists body_onboarding text;
