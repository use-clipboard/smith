-- ============================================================
--  Proposals — Send via a linked Gmail account
-- ============================================================
--  Admin picks a team member with a connected Gmail (set up under
--  Email Triage) whose account is used to send proposal emails to
--  prospects. Falls back to Resend if not set or that user isn't
--  connected.
-- ============================================================

alter table public.firm_proposal_settings
  add column if not exists proposal_email_sender_user_id uuid
    references public.users on delete set null;
