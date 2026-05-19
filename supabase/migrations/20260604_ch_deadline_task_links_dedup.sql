-- CH Secretarial — deduplicate link rows + add a unique constraint so
-- repeated backfill / bulk runs can never create the same (task, type)
-- link twice.
--
-- The original migration (20260529) only had a UUID primary key with no
-- uniqueness on (task_id, deadline_type). Some firms ended up with
-- duplicate link rows after multiple backfill runs predating the RLS fix.
-- This migration:
--   1. Keeps the newest link row per (task_id, deadline_type) and deletes
--      the rest — newest "wins" because it carries the most up-to-date
--      sync state (last_synced_deadline, status, consecutive_failures).
--   2. Adds a unique constraint so future inserts get a clean upsert path.

-- Step 1 — dedup. Uses a CTE to rank rows per (task_id, deadline_type) by
-- updated_at then created_at then id (deterministic tiebreaker), then
-- deletes everything except rank #1.
with ranked as (
  select id,
         row_number() over (
           partition by task_id, deadline_type
           order by updated_at desc nulls last,
                    created_at desc nulls last,
                    id desc
         ) as rn
  from public.ch_deadline_task_links
)
delete from public.ch_deadline_task_links
where id in (select id from ranked where rn > 1);

-- Step 2 — unique constraint. One link per (task, deadline_type) pair.
alter table public.ch_deadline_task_links
  drop constraint if exists ch_deadline_task_links_task_type_uniq;

alter table public.ch_deadline_task_links
  add constraint ch_deadline_task_links_task_type_uniq
    unique (task_id, deadline_type);
