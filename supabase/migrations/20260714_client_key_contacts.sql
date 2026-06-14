-- Key Contacts for a client record.
--
-- Stored as a JSONB array on the client. Each contact is either typed in
-- manually or linked to another existing client (in which case
-- linked_client_id references that client and name/email/phone are snapshotted
-- at link time so the card renders without an extra lookup).
--
-- Shape: [{ name, role, email, phone, linked_client_id }]

alter table public.clients
  add column if not exists key_contacts jsonb not null default '[]'::jsonb;
