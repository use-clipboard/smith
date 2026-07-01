-- Email task links — store stable, cross-mailbox message identifiers
--
-- Same fix as email_allocations (20260701_email_allocations_rfc_ids.sql): task
-- links were keyed only on Gmail's per-mailbox thread_id, so a task created from
-- an email by one user never showed the blue "task" marker for other users on
-- the same chain (their mailbox's thread_id differs). Record the RFC 2822
-- Message-ID + reply-chain references so the link can be matched across mailboxes
-- and across every message in the conversation.
--
-- Existing rows have no RFC ids (headers weren't captured at link time) and stay
-- mailbox-local until the task is re-linked.

alter table public.email_task_links
  add column if not exists rfc_message_id text;

alter table public.email_task_links
  add column if not exists rfc_references text[];

-- Support the firm-wide lookup in /api/email/thread-meta.
create index if not exists email_task_links_rfc_message_id_idx
  on public.email_task_links (firm_id, rfc_message_id);
