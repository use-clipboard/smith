-- Add active/inactive status to clients
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;

-- Client links table (individuals linked to businesses, or any client-to-client relationship)
CREATE TABLE IF NOT EXISTS public.client_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id uuid NOT NULL REFERENCES public.firms ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.clients ON DELETE CASCADE,
  linked_client_id uuid NOT NULL REFERENCES public.clients ON DELETE CASCADE,
  link_type text NOT NULL DEFAULT 'associated',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT client_links_no_self CHECK (client_id <> linked_client_id),
  CONSTRAINT client_links_unique UNIQUE (client_id, linked_client_id)
);

ALTER TABLE public.client_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "client_links: same firm"
  ON public.client_links FOR ALL
  USING (firm_id = (
    SELECT firm_id FROM public.users WHERE id = auth.uid()
  ));

CREATE INDEX IF NOT EXISTS client_links_client_id_idx ON public.client_links(client_id);
CREATE INDEX IF NOT EXISTS client_links_linked_client_id_idx ON public.client_links(linked_client_id);
CREATE INDEX IF NOT EXISTS clients_is_active_idx ON public.clients(is_active);
