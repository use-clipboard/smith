-- Add 'status' column to clients, replacing the boolean is_active with a
-- three-way enum: active | hold | inactive

ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'hold', 'inactive'));

-- Migrate existing data
UPDATE clients SET status = CASE WHEN is_active THEN 'active' ELSE 'inactive' END;

-- Drop old column (and its index if present)
DROP INDEX IF EXISTS clients_is_active_idx;
ALTER TABLE clients DROP COLUMN IF EXISTS is_active;

-- Index for the new column
CREATE INDEX IF NOT EXISTS clients_status_idx ON clients (status);
