-- Email allocations — store stable, cross-mailbox message identifiers
--
-- PROBLEM: allocations were keyed only on Gmail's internal thread_id/message_id.
-- Those ids are scoped to a single Gmail account, so the SAME email chain has a
-- different thread_id in every user's mailbox. Because allocation visibility
-- (the green "allocated" marker + firm-wide sharing) matched on thread_id, an
-- email allocated by one user never showed as allocated for anyone else — their
-- inbox rows carry their own mailbox's ids, which don't match.
--
-- FIX: also record the RFC 2822 Message-ID header of the allocated message and
-- its reply-chain references (In-Reply-To + References). These headers are
-- globally unique and identical in every recipient's mailbox, so they let us
-- match an allocation across users and across every message in the chain.
--
-- Existing rows have no RFC ids (the headers weren't captured at allocation
-- time) and stay mailbox-local until re-allocated — a best-effort backfill
-- isn't possible without re-fetching each thread from the original mailbox.

alter table public.email_allocations
  add column if not exists rfc_message_id text;

alter table public.email_allocations
  add column if not exists rfc_references text[];

-- Support the firm-wide lookup in /api/email/thread-meta.
create index if not exists email_allocations_rfc_message_id_idx
  on public.email_allocations (firm_id, rfc_message_id);
