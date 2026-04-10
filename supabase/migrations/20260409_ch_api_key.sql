-- Add Companies House API key to firms table
ALTER TABLE firms ADD COLUMN IF NOT EXISTS ch_api_key text;

-- RLS: only admin users of the same firm can read/update this column.
-- The column is accessed exclusively through service-role API routes that
-- enforce admin-only access at the application layer, consistent with the
-- pattern used for anthropic_api_key.
