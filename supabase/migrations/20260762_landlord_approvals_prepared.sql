-- ============================================================
--  Landlord approvals — distinguish "prepared" from "actually sent"
-- ============================================================
--  When Email Triage is on we don't send the approval email ourselves: we
--  record the approval, render the email, and hand it to the in-app compose
--  window so the user sends it from their own Gmail. But `sent_at` defaulted to
--  now() on insert, so the row said "Sent" the moment the draft was PREPARED —
--  even if the user closed the compose window without ever sending it.
--
--  So: sent_at becomes nullable with no default, and is set only when the send
--  really happens (directly by the send route, or by the compose window's
--  'smith:compose-sent' event via /api/landlord/approvals/[id]/mark-sent).
--  prepared_at records when the row was created.
--
--  Existing rows keep their sent_at, so history stays as it reads today.
-- ============================================================

-- Added nullable + backfilled first: defaulting straight to now() would stamp
-- every historical row with the migration time and scramble their order (the
-- approvals list sorts on prepared_at).
alter table public.landlord_approvals
  add column if not exists prepared_at timestamptz;

update public.landlord_approvals
   set prepared_at = coalesce(sent_at, created_at)
 where prepared_at is null;

-- An earlier revision of this migration added the column with `default now()`,
-- which stamped existing rows with the migration time — leaving them "prepared"
-- AFTER they were sent. Re-point those at their real send time.
update public.landlord_approvals
   set prepared_at = sent_at
 where sent_at is not null and prepared_at > sent_at;

alter table public.landlord_approvals alter column prepared_at set default now();
alter table public.landlord_approvals alter column prepared_at set not null;

alter table public.landlord_approvals alter column sent_at drop not null;
alter table public.landlord_approvals alter column sent_at drop default;

comment on column public.landlord_approvals.prepared_at is
  'When the approval row was created (the draft was prepared).';
comment on column public.landlord_approvals.sent_at is
  'When the email actually went out. Null = prepared but never sent — the user closed the compose window.';
