-- ============================================================
--  Proposals — post-acceptance action config
-- ============================================================
--  Lets the preparer choose, per proposal, what happens automatically
--  when the prospect accepts:
--
--    • 'none'                — no automatic next steps; just notify the
--                              firm. Used when the firm wants to handle
--                              onboarding outside SMITH for this client.
--    • 'send_onboarding'     — email the prospect a link to fill in an
--                              onboarding form. The form template is
--                              chosen via post_acceptance_onboarding_form_id
--                              (NULL = use the firm's default active form).
--                              This was the implicit behaviour before this
--                              migration, so it's the default for
--                              backfilled rows.
--    • 'auto_create_client'  — create a clients row immediately from the
--                              prospect's details and skip the onboarding
--                              form. The firm can fill in any remaining
--                              client details from the Clients screen.
-- ============================================================

alter table public.proposals
  add column if not exists post_acceptance_action text not null default 'send_onboarding'
    check (post_acceptance_action in ('none', 'send_onboarding', 'auto_create_client'));

alter table public.proposals
  add column if not exists post_acceptance_onboarding_form_id uuid
    references public.proposal_onboarding_forms(id) on delete set null;

comment on column public.proposals.post_acceptance_action is
  'What happens automatically when the prospect accepts: none | send_onboarding | auto_create_client.';
comment on column public.proposals.post_acceptance_onboarding_form_id is
  'Specific onboarding form template to send on acceptance. Only meaningful when post_acceptance_action = send_onboarding. NULL falls back to the firm''s default active form.';

-- ── Totals display mode ───────────────────────────────────────────────────
-- Lets the preparer pick how the headline total reads on the prospect-facing
-- proposal:
--   • 'first_year' — default; shows a "First-year total" headline calculated
--                    from all frequencies (one-off + monthly×12 + quarterly×4
--                    + annual). Best for fixed-fee-style proposals.
--   • 'monthly'    — emphasises the monthly retainer figure. The first-year
--                    line is hidden and any discount is expressed per-month.
--                    Best for ongoing-services proposals like bookkeeping +
--                    payroll retainers.
alter table public.proposals
  add column if not exists totals_display text not null default 'first_year'
    check (totals_display in ('first_year', 'monthly'));

comment on column public.proposals.totals_display is
  'How the totals block summarises the proposal: first_year (default, headline annual figure) or monthly (headline monthly retainer).';
