-- Allow multiple links between the same two clients as long as the link_type differs.
-- Previously the unique constraint was on (client_id, linked_client_id), which blocked
-- e.g. someone being both a Director and a Shareholder of the same company.

ALTER TABLE public.client_links
  DROP CONSTRAINT IF EXISTS client_links_unique;

ALTER TABLE public.client_links
  ADD CONSTRAINT client_links_unique UNIQUE (client_id, linked_client_id, link_type);
