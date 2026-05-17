-- MTD IT — replace the two source-lifecycle toggles with a single
-- "auto-delete when quarter is marked complete" toggle.
--
-- Previously we had:
--   auto_delete_source_after_save   (default OFF)
--   auto_delete_source_on_submit    (default ON, but 'submitted' status
--                                    isn't reachable yet — HMRC API not built)
--
-- The new model: tie auto-delete to the natural end of the in-app workflow
-- (status flipping to 'complete'). The Save-to-records modal becomes the
-- last-chance-to-archive prompt that opens before deletion fires.

-- Add the new column with a safe default
alter table public.mtd_it_firm_settings
  add column if not exists auto_delete_source_on_complete boolean not null default true;

-- Drop the now-superseded columns. The new "on complete" setting covers
-- both former behaviours.
alter table public.mtd_it_firm_settings
  drop column if exists auto_delete_source_after_save,
  drop column if exists auto_delete_source_on_submit;
