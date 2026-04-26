-- ── CH Cache: track whether last refresh was manual or scheduled ──────────────
ALTER TABLE ch_cache
  ADD COLUMN IF NOT EXISTS refresh_type text DEFAULT 'manual'
    CHECK (refresh_type IN ('manual', 'scheduled'));

-- ── Firms: track which list the schedule should refresh ───────────────────────
-- 'client_list' = limited company clients (companies_house_id)
-- 'custom_list' = the firm's saved ch_company_numbers list
ALTER TABLE firms
  ADD COLUMN IF NOT EXISTS ch_refresh_list_type text DEFAULT 'client_list'
    CHECK (ch_refresh_list_type IN ('client_list', 'custom_list'));

COMMENT ON COLUMN ch_cache.refresh_type IS
  'Whether this refresh was triggered manually by a user or by the scheduled cron job';

COMMENT ON COLUMN firms.ch_refresh_list_type IS
  'Which company list the scheduled cron refresh should use: client_list or custom_list';
