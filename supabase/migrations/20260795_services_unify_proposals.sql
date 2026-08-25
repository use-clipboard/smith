-- Unify the services catalogue: the client Services module now shares the
-- Proposals module's catalogue (proposal_services / proposal_packages) instead
-- of the short-lived firm_service_catalogue. Also adds VAT to client services
-- and the proposal-acceptance pre-population toggle.

-- Pre-populate a client's Services from an accepted proposal's line items.
alter table public.firm_proposal_settings
  add column if not exists pre_populate_services boolean not null default false;

-- Per-client service carries its VAT treatment (copied from the catalogue
-- service / proposal line) so the Services tab can show inc/ex VAT.
--   firm_default | inclusive | exclusive | exempt   (matches proposal_services)
alter table public.client_services
  add column if not exists vat_treatment text;

-- client_services.catalogue_id now references the SHARED catalogue
-- (proposal_services) rather than the retired firm_service_catalogue. Clear any
-- id that doesn't exist in proposal_services, then drop the old FK so new rows
-- can store a proposal_services id (kept as a soft reference — no new FK, so a
-- deleted catalogue service simply leaves the client service standing).
update public.client_services set catalogue_id = null
  where catalogue_id is not null
    and not exists (select 1 from public.proposal_services ps where ps.id = catalogue_id);
alter table public.client_services drop constraint if exists client_services_catalogue_id_fkey;
