-- MTD IT: capture an invoice number per entry.
--
-- The Review & Adjust screen (and the AI analyse step) now record an invoice
-- number alongside the existing supplier/description/amount for every income,
-- expense and flagged entry. Nullable free text — HMRC submissions don't use it;
-- it's metadata for the firm's own review and records.
--
-- MUST be applied before deploying the matching code: the analyse insert and the
-- review Save both write this column, so those writes 500 until it exists.

alter table mtd_it_entries
  add column if not exists invoice_number text;
