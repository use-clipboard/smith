-- Add unique constraint on google_drive_file_id so upserts work correctly.
-- This also covers the pseudo-IDs used for tool-uploaded files (tool:...).
ALTER TABLE public.vault_documents
  ADD CONSTRAINT vault_documents_google_drive_file_id_key
  UNIQUE (google_drive_file_id);
