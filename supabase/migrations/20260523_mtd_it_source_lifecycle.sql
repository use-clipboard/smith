-- MTD IT — source-document lifecycle settings.
--
-- Adds two firm-level toggles that control when source documents stored in
-- the private mtd-it-source-docs bucket get cleaned up:
--
--   auto_delete_source_after_save    Default OFF (opt-in, destructive).
--     When ON, after a successful "Save to records" run that
--     (a) included source documents AND
--     (b) saved to Google Drive,
--     the local supabase copies are wiped. Drive becomes the authoritative
--     archive.
--
--   auto_delete_source_on_submit     Default ON (safe — only fires once the
--     quarter has been submitted to HMRC, by which point the user
--     definitely doesn't need SMITH's copies for editing.)
--
-- The cleanup itself happens in the save-to-records POST handler and the
-- quarters PATCH handler respectively. Both are gated by these flags.

alter table public.mtd_it_firm_settings
  add column if not exists auto_delete_source_after_save boolean not null default false,
  add column if not exists auto_delete_source_on_submit  boolean not null default true;
