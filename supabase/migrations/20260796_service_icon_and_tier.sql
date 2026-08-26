-- Restore the per-service icon on the shared catalogue, and let a client's
-- service remember which tier of a tiered catalogue service was chosen.

-- Icon key (lucide registry key, e.g. 'bookkeeping') for a catalogue service.
-- The client Services tab already stores its own icon on client_services; this
-- lets the catalogue carry a default icon that copies over on allocation.
alter table public.proposal_services
  add column if not exists icon text;

-- When a tiered catalogue service is added to a client, record the chosen tier's
-- label (its price is copied into price_pence as usual). Null for fixed-fee
-- services / custom entries.
alter table public.client_services
  add column if not exists tier_label text;
