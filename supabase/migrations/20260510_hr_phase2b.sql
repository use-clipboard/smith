-- ============================================================
--  HR module — Phase 2b: Confidential disclosures
-- ============================================================
--
--  Channel for staff to raise concerns (harassment, bullying,
--  discrimination, safety, financial wrongdoing, other) to a
--  recipient of their choice — their manager, a different manager,
--  or the firm's designated Confidential HR Recipient.
--
--  Anonymity: when is_anonymous = true, the reporter_id is still
--  stored (so the reporter can see their own disclosures and receive
--  notifications), but it is NEVER exposed to the recipient via
--  the API. The recipient sees only the disclosure body + thread.
--
--  Admin override is intentionally OFF here. Firm admins can only
--  see disclosures addressed to them. Otherwise the channel would
--  be theatre — admins are often party to the issue being raised.
--  Anyone designated as the Confidential Recipient sees what is
--  routed to them; nothing more.
--
--  Every read of a disclosure body gets an audit row. This lets
--  firms demonstrate compliance and lets reporters see who has
--  accessed their disclosure.
-- ============================================================

-- ── Disclosures ──────────────────────────────────────────────
create table if not exists public.hr_disclosures (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references public.firms on delete cascade,
  -- Reporter is always recorded so the user can see their own disclosures
  -- and receive notifications. The API layer hides this from recipients
  -- when is_anonymous = true.
  reporter_id uuid not null references public.users on delete cascade,
  is_anonymous boolean not null default false,
  -- Recipient chosen at file time. One of three roles:
  --   'manager'              — the reporter's direct manager
  --   'other_manager'        — any other manager in the firm
  --   'confidential_recipient' — the firm-designated HR confidant
  recipient_id uuid not null references public.users on delete restrict,
  recipient_role text not null check (recipient_role in (
    'manager', 'other_manager', 'confidential_recipient'
  )),
  category text not null check (category in (
    'harassment', 'bullying', 'discrimination', 'safety',
    'financial_wrongdoing', 'whistleblowing', 'other'
  )),
  urgency text not null default 'medium' check (urgency in ('low', 'medium', 'high')),
  body text not null,
  status text not null default 'submitted' check (status in (
    'submitted', 'acknowledged', 'in_progress', 'resolved', 'closed_no_action'
  )),
  -- Recipient-only notes that are NOT shared back to the reporter
  recipient_notes text,
  resolution_summary text,  -- shared with reporter when status moves to resolved/closed
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists hr_disclosures_reporter_idx on public.hr_disclosures (reporter_id, created_at desc);
create index if not exists hr_disclosures_recipient_idx on public.hr_disclosures (recipient_id, status, created_at desc);
create index if not exists hr_disclosures_firm_idx on public.hr_disclosures (firm_id, created_at desc);

alter table public.hr_disclosures enable row level security;

-- Read: reporter (always) OR recipient. NO admin override — see file header.
create policy "hr_disclosures: read reporter or recipient"
  on public.hr_disclosures for select
  using (
    firm_id = public.my_firm_id() and (
      reporter_id = auth.uid() or recipient_id = auth.uid()
    )
  );

-- Insert: only the reporter themselves (for themselves) within their firm.
create policy "hr_disclosures: reporter inserts own"
  on public.hr_disclosures for insert
  with check (
    firm_id = public.my_firm_id() and reporter_id = auth.uid()
  );

-- Update: reporter (limited fields — handled in API) and recipient
create policy "hr_disclosures: update reporter or recipient"
  on public.hr_disclosures for update
  using (
    firm_id = public.my_firm_id() and (
      reporter_id = auth.uid() or recipient_id = auth.uid()
    )
  );

-- No DELETE policy → no deletes allowed via the anon/authed key.
-- Service-role queries from the server can still delete if absolutely needed.

-- ── Thread messages ─────────────────────────────────────────
create table if not exists public.hr_disclosure_messages (
  id uuid primary key default gen_random_uuid(),
  disclosure_id uuid not null references public.hr_disclosures on delete cascade,
  -- Author is always stored. When is_anonymous is true on the parent disclosure
  -- AND author_role = 'reporter', the API hides author_id from the recipient.
  author_id uuid not null references public.users on delete cascade,
  author_role text not null check (author_role in ('reporter', 'recipient')),
  body text not null,
  created_at timestamptz not null default now()
);

create index if not exists hr_disclosure_msgs_disclosure_idx on public.hr_disclosure_messages (disclosure_id, created_at);

alter table public.hr_disclosure_messages enable row level security;

-- Read: any party to the parent disclosure
create policy "hr_disclosure_messages: read parties"
  on public.hr_disclosure_messages for select
  using (
    exists (
      select 1 from public.hr_disclosures d
      where d.id = disclosure_id
        and d.firm_id = public.my_firm_id()
        and (d.reporter_id = auth.uid() or d.recipient_id = auth.uid())
    )
  );

-- Insert: only parties of the parent disclosure
create policy "hr_disclosure_messages: insert parties"
  on public.hr_disclosure_messages for insert
  with check (
    exists (
      select 1 from public.hr_disclosures d
      where d.id = disclosure_id
        and d.firm_id = public.my_firm_id()
        and (d.reporter_id = auth.uid() or d.recipient_id = auth.uid())
    ) and author_id = auth.uid()
  );

-- ── Audit log (who viewed what, when) ───────────────────────
create table if not exists public.hr_disclosure_audit (
  id uuid primary key default gen_random_uuid(),
  disclosure_id uuid not null references public.hr_disclosures on delete cascade,
  actor_id uuid not null references public.users on delete cascade,
  action text not null check (action in (
    'viewed', 'status_changed', 'message_sent', 'recipient_changed'
  )),
  details jsonb,
  created_at timestamptz not null default now()
);

create index if not exists hr_disclosure_audit_disclosure_idx on public.hr_disclosure_audit (disclosure_id, created_at);

alter table public.hr_disclosure_audit enable row level security;

-- Audit rows visible to parties of the parent disclosure (so the reporter can
-- see who has accessed their disclosure)
create policy "hr_disclosure_audit: read parties"
  on public.hr_disclosure_audit for select
  using (
    exists (
      select 1 from public.hr_disclosures d
      where d.id = disclosure_id
        and (d.reporter_id = auth.uid() or d.recipient_id = auth.uid())
    )
  );

-- Audit insertion is done server-side via the service role; no client policy.
