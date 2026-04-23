-- Enforce unique client_ref per firm.
-- Uses a partial unique index so that clients with no ref (null) are not affected.
CREATE UNIQUE INDEX IF NOT EXISTS clients_firm_client_ref_unique
  ON clients (firm_id, client_ref)
  WHERE client_ref IS NOT NULL;
