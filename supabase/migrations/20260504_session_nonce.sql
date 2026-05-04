-- Single-session enforcement: track the active session nonce per user.
-- When a user logs in, a new nonce is written here.
-- Middleware rejects requests whose cookie nonce doesn't match this value.
ALTER TABLE users ADD COLUMN IF NOT EXISTS active_session_nonce text;
