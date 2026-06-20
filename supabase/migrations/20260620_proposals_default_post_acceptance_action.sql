-- ============================================================
--  Proposals — firm-wide default post-acceptance action
-- ============================================================
--  Migration 20260614 added a PER-PROPOSAL post_acceptance_action so the
--  preparer can choose, on each proposal, what happens when the prospect
--  accepts (none | send_onboarding | auto_create_client).
--
--  This migration adds the FIRM-LEVEL default that new proposals inherit,
--  so a firm that never wants onboarding forms can set "skip" once in
--  Settings → Proposals → Defaults & onboarding instead of changing every
--  proposal. The per-proposal control still overrides this default.
--
--  Default stays 'send_onboarding' to preserve existing behaviour for firms
--  that don't touch the setting.
-- ============================================================

alter table public.firm_proposal_settings
  add column if not exists default_post_acceptance_action text not null default 'send_onboarding'
    check (default_post_acceptance_action in ('none', 'send_onboarding', 'auto_create_client'));

comment on column public.firm_proposal_settings.default_post_acceptance_action is
  'Default automatic action applied to new proposals when the prospect accepts: none | send_onboarding | auto_create_client. Inherited at proposal-creation time; the per-proposal proposals.post_acceptance_action overrides it.';
