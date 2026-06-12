-- Timeline email duplicates — cleanup + prevention.
--
-- Two users could allocate the same email to the same client (thread-level vs
-- per-message scope, or a plain race) and the timeline ended up with the email
-- twice. The app now checks the timeline before inserting; this migration
-- (1) removes existing duplicate email notes, (2) removes the duplicate
-- allocation rows behind them, and (3) adds a partial unique index so two
-- thread-level (message_id IS NULL) allocations for the same thread+client can
-- never coexist again — the plain UNIQUE constraint treats NULLs as distinct,
-- which is exactly how the duplicates slipped in.

-- 1. Delete duplicate email timeline notes: same firm + client + subject +
--    note date + same email (threadId + message timestamp inside the JSON).
--    Keeps the earliest note of each duplicate set.
delete from client_timeline_notes d
using client_timeline_notes k
where d.note_type = 'email' and k.note_type = 'email'
  and d.firm_id = k.firm_id
  and d.client_id = k.client_id
  and d.title = k.title
  and d.note_date = k.note_date
  and d.content::jsonb ->> 'threadId' = k.content::jsonb ->> 'threadId'
  and coalesce(d.content::jsonb ->> 'date', '') = coalesce(k.content::jsonb ->> 'date', '')
  and (d.created_at, d.id) > (k.created_at, k.id);

-- 2. Dedupe thread-level allocation rows (message_id IS NULL): keep one row
--    per (firm, thread, client) — preferring a row still linked to a timeline
--    note (deleting a note above SET NULLed its allocation's link).
delete from email_allocations a
using email_allocations b
where a.message_id is null and b.message_id is null
  and a.firm_id = b.firm_id
  and a.thread_id = b.thread_id
  and a.client_id = b.client_id
  and a.id <> b.id
  and (
    (a.timeline_entry_id is null and b.timeline_entry_id is not null)
    or ((a.timeline_entry_id is null) = (b.timeline_entry_id is null) and a.id > b.id)
  );

-- 3. Also drop per-message allocation rows orphaned by step 1 (their note was
--    deleted as a duplicate, so the link is NULL but a surviving row covers it).
delete from email_allocations a
using email_allocations b
where a.message_id is not null
  and a.timeline_entry_id is null
  and b.timeline_entry_id is not null
  and a.firm_id = b.firm_id
  and a.thread_id = b.thread_id
  and a.client_id = b.client_id
  and a.id <> b.id;

-- 4. Hard stop: at most ONE thread-level allocation per (firm, thread, client).
create unique index if not exists email_allocations_thread_client_nullmsg_uniq
  on email_allocations (firm_id, thread_id, client_id)
  where message_id is null;
