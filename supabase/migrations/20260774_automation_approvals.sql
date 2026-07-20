-- Campaigns module — automation approvals.
--
-- Campaign sends already respect the firm's approval requirement, but
-- automations and journeys deliver on their own schedule and so bypassed it.
-- Rather than asking a human to approve every daily firing, the *automation*
-- itself is approved once: an unapproved automation can't be switched on while
-- the firm requires review, and editing its content or steps clears that
-- approval so it must be reviewed again.

alter table public.campaign_automations
  add column if not exists approved_at timestamptz,
  add column if not exists approved_by uuid references public.users(id) on delete set null;

-- The audit trail now covers automations as well as campaigns; exactly one of
-- the two targets is set on each row.
alter table public.campaign_approvals
  add column if not exists automation_id uuid references public.campaign_automations(id) on delete cascade;

alter table public.campaign_approvals
  alter column campaign_id drop not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'campaign_approvals_target_chk'
  ) then
    alter table public.campaign_approvals
      add constraint campaign_approvals_target_chk
      check (num_nonnulls(campaign_id, automation_id) = 1);
  end if;
end $$;

create index if not exists campaign_approvals_automation_idx
  on public.campaign_approvals (automation_id, created_at desc);
