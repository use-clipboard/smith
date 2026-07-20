-- Campaigns module — approval workflow + audit trail.
--
-- A firm can require campaigns to be reviewed before they send (optionally only
-- above a recipient threshold). Every governance action is appended to
-- campaign_approvals, giving an auditable record of who submitted, who
-- approved/rejected, and who sent — which matters for a regulated practice.

alter table public.campaign_settings
  add column if not exists require_approval boolean not null default false,
  -- Only require approval when the send reaches this many recipients (0 = always).
  add column if not exists approval_min_recipients int not null default 0,
  -- When false, only an admin can approve; when true the author may self-approve.
  add column if not exists allow_self_approve boolean not null default false;

-- Approval is tracked on the campaign itself (not just via status) so it
-- survives the status moving on to 'scheduled'/'sending'. Cleared whenever the
-- content or audience changes, so an approved campaign can't be edited and then
-- sent without a fresh review.
alter table public.campaigns
  add column if not exists approved_at timestamptz,
  add column if not exists approved_by uuid references public.users(id) on delete set null;

create table if not exists public.campaign_approvals (
  id          uuid primary key default gen_random_uuid(),
  firm_id     uuid not null references public.firms(id) on delete cascade,
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  user_id     uuid references public.users(id) on delete set null,
  action      text not null
                check (action in ('submitted', 'approved', 'changes_requested', 'withdrawn', 'sent')),
  comment     text not null default '',
  created_at  timestamptz not null default now()
);

create index if not exists campaign_approvals_campaign_idx
  on public.campaign_approvals (campaign_id, created_at desc);

alter table public.campaign_approvals enable row level security;
drop policy if exists campaign_approvals_firm_all on public.campaign_approvals;
create policy campaign_approvals_firm_all on public.campaign_approvals
  for all using (
    firm_id = (select u.firm_id from public.users u where u.id = auth.uid())
  ) with check (
    firm_id = (select u.firm_id from public.users u where u.id = auth.uid())
  );
