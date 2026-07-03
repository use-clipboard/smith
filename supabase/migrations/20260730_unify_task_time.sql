-- Unify task time into the Timesheets ledger.
--
-- Makes public.time_entries the single source of truth for time. Adds a
-- step_id link (to preserve the Tasks tool's per-step logging) and a
-- provenance column so we can back-fill existing task_time_entries idempotently.
--
-- Apply AFTER 20260729_time_entries_task.sql (which adds task_id/task_title).
-- The Tasks API prefers time_entries but falls back to task_time_entries until
-- these columns exist, so deploying before this migration never breaks time
-- logging.

alter table public.time_entries
  add column if not exists step_id uuid references public.task_steps(id) on delete set null,
  add column if not exists source_task_time_entry_id uuid;

create index if not exists time_entries_step_idx on public.time_entries (step_id);
create unique index if not exists time_entries_src_tte_idx
  on public.time_entries (source_task_time_entry_id)
  where source_task_time_entry_id is not null;

-- ── Back-fill existing task_time_entries → time_entries ─────────────────────
-- Idempotent: skips rows already copied (matched on source_task_time_entry_id).
insert into public.time_entries
  (firm_id, user_id, client_id, client_name, task_id, task_title, step_id,
   entry_date, start_time, activity, department, entry_type, minutes, rate_pence,
   notes, source, source_task_time_entry_id, created_at)
select
  t.firm_id,
  coalesce(tte.user_id, t.created_by),
  t.client_id,
  coalesce(c.name, 'Internal'),
  tte.task_id,
  t.title,
  tte.step_id,
  (tte.started_at)::date,
  to_char(tte.started_at, 'HH24:MI'),
  coalesce(nullif(t.title, ''), 'Task time'),
  null,
  case when t.is_internal then 'internal' else 'billable' end,
  greatest(1, coalesce(tte.duration_minutes,
                       round(extract(epoch from (tte.ended_at - tte.started_at)) / 60))::int),
  case when t.is_internal then 0 else coalesce(u.charge_out_rate_pence, 0) end,
  tte.notes,
  'timer',
  tte.id,
  tte.created_at
from public.task_time_entries tte
join public.tasks t on t.id = tte.task_id
left join public.clients c on c.id = t.client_id
left join public.users u on u.id = coalesce(tte.user_id, t.created_by)
where coalesce(tte.duration_minutes,
               extract(epoch from (tte.ended_at - tte.started_at)) / 60) >= 1
  and not exists (
    select 1 from public.time_entries te where te.source_task_time_entry_id = tte.id
  );
