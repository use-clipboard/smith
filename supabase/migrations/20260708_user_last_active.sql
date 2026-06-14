-- "Last seen" that reflects when a user was last actually using the app, not
-- just when they last typed their password (last_sign_in_at goes stale with
-- remembered sessions). Updated by a lightweight client heartbeat.

alter table public.users add column if not exists last_active_at timestamptz;
