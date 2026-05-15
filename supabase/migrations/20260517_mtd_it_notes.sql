-- MTD IT — shared per-client notes pad
--
-- A single free-form text field on the clients table that the MTD IT dashboard
-- shows in the expanded quarter panel. Everyone in the firm can see and edit
-- it (firm-scoped RLS comes from the existing clients table policies).
alter table public.clients
  add column if not exists mtd_it_notes text;
