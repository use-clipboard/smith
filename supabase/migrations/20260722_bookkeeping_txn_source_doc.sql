-- Bookkeeping — source-document LINK on a transaction.
--
-- We deliberately do NOT store the file itself. The Capture / Vault flow saves
-- the document to the client's Google Drive and returns a link; we keep just
-- that link (+ a display name) against the transaction, so the source invoice/
-- receipt is one click away without duplicating storage.

alter table public.bookkeeping_transactions
  add column if not exists source_doc_url  text,
  add column if not exists source_doc_name text;

comment on column public.bookkeeping_transactions.source_doc_url is
  'Link to the source document (e.g. a Google Drive file created via Capture/Vault). The file is NOT stored in SMITH — this is a pointer only.';
