-- Cached Companies House data per firm (one row per firm, overwritten on each refresh)
CREATE TABLE IF NOT EXISTS ch_cache (
  firm_id          uuid PRIMARY KEY REFERENCES firms(id) ON DELETE CASCADE,
  companies        jsonb NOT NULL DEFAULT '[]',
  refreshed_at     timestamptz,
  refresh_status   text CHECK (refresh_status IN ('success', 'partial', 'failed')),
  refresh_error    text,
  companies_fetched int DEFAULT 0,
  companies_total   int DEFAULT 0
);

-- Allow firm members to read their own cache; service role writes it
ALTER TABLE ch_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Firm members can read their cache"
  ON ch_cache FOR SELECT
  USING (
    firm_id IN (
      SELECT firm_id FROM users WHERE id = auth.uid()
    )
  );

-- Scheduled refresh times for CH Secretarial (admin-configurable, HH:MM strings, London time)
ALTER TABLE firms ADD COLUMN IF NOT EXISTS ch_refresh_times text[] DEFAULT NULL;
