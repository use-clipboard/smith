-- Per-firm policy for how tasks should behave when their client is moved
-- to "On Hold" or "Inactive". Stored as JSONB on the firms row so a firm
-- admin can tweak the rules in one place and every task view / API route
-- reads the same source of truth.
--
-- Shape (all booleans, all default true so the recommended behaviour
-- applies out of the box):
--
-- {
--   "on_hold": {
--     "pause_recurrence":      true,   -- don't spawn next cycle while on hold
--     "exclude_from_overdue":  true,   -- hide from Overdue / Due-in-7d counts
--     "grey_out_rows":         true,   -- visual de-emphasis in lists/cards
--     "hide_from_default":     true    -- omit from "Open" filter; toggle to show
--   },
--   "inactive": {
--     "auto_cancel_open":      true,   -- cancel all open tasks on transition
--     "break_ch_links":        true,   -- mark CH-deadline links as broken
--     "hide_from_default":     true    -- omit from default task views
--   }
-- }

alter table public.firms
  add column if not exists task_client_status_policy jsonb not null default jsonb_build_object(
    'on_hold',  jsonb_build_object(
      'pause_recurrence',     true,
      'exclude_from_overdue', true,
      'grey_out_rows',        true,
      'hide_from_default',    true
    ),
    'inactive', jsonb_build_object(
      'auto_cancel_open',     true,
      'break_ch_links',       true,
      'hide_from_default',    true
    )
  );

comment on column public.firms.task_client_status_policy is
  'Per-firm rules for how tasks attached to On-Hold / Inactive clients behave.';
