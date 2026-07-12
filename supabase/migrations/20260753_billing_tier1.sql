-- Billing module — Tier 1: VAT, send-invoice-by-email, credit notes.
--
-- • vat_registered drives whether the firm charges VAT on its fees by default.
-- • email_sender_mailbox_id = the firm Gmail (firm_sending_mailboxes) invoices
--   send from; invoice_email_subject/body are the editable templates (merge tags).
-- • invoices.credit_pence tracks credit notes raised against an invoice, so the
--   outstanding balance = total − paid − credit.

alter table public.billing_settings
  add column if not exists vat_registered          boolean not null default true,
  add column if not exists email_sender_mailbox_id uuid,
  add column if not exists invoice_email_subject    text not null default '',
  add column if not exists invoice_email_body        text not null default '';

alter table public.invoices
  add column if not exists credit_pence integer not null default 0;
