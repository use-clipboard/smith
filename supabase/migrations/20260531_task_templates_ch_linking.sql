-- Task templates — CH Secretarial deadline linking
--
-- A template can declare itself "CH-linked": every task instantiated from
-- the template gets an automatic ch_deadline_task_links row pointing at
-- the chosen deadline type on that client's CH record. The user picks the
-- offset (e.g. -14 = due 14 days before the deadline).
--
-- When ch_deadline_type is null the template is "manual" (existing
-- behaviour — recurrence_type / recurrence_interval_days dictate cadence).
-- When it's set, the recurrence fields are ignored at instantiation time
-- because the CH deadline (slid / renewed by the sync engine) is the
-- single source of truth for due dates.

alter table public.task_templates
  add column if not exists ch_deadline_type text
    check (ch_deadline_type in ('accounts_due', 'cs_due', 'officer_idv_due', 'psc_idv_due')),
  add column if not exists ch_offset_days int not null default 0
    check (ch_offset_days between -365 and 365);

comment on column public.task_templates.ch_deadline_type is
  'When set, tasks created from this template are auto-linked to this CH deadline. NULL = manual recurrence template (legacy behaviour).';
comment on column public.task_templates.ch_offset_days is
  'Days to offset from the CH deadline (negative = due before). Ignored when ch_deadline_type is NULL.';
