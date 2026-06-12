-- Per-user email triage settings (mark-read on auto-triage, age-based
-- auto-file of old untriaged emails). One JSONB blob per user — saved to the
-- account so the preference follows the user across browsers/machines; shape:
--   { "markReadOnAutoTriage": boolean, "autoFileEnabled": boolean, "autoFileDays": number }
-- NULL means "never configured" — the app falls back to defaults.
alter table users add column if not exists email_triage_settings jsonb;
