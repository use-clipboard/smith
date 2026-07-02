-- Pre-launch marketing waitlist.
--
-- Backs the public "Join the waitlist" lightbox on the marketing site while
-- SMITH is pre-launch (not yet open to new firms). A visitor leaves their email
-- (and optionally a firm name); we store it here and notify them at launch.
--
-- All writes happen server-side via the service role (POST /api/waitlist), which
-- bypasses RLS. RLS is enabled with NO public policies, so the anon client can
-- neither read nor write this table directly — the email list is not exposed.

create table if not exists public.waitlist (
  id          uuid primary key default gen_random_uuid(),
  email       text not null,
  firm_name   text,
  -- Where the signup came from (e.g. 'marketing_hero', 'marketing_pricing').
  source      text,
  -- Light metadata for later segmentation / abuse review.
  user_agent  text,
  created_at  timestamptz not null default now(),
  -- Set when we email everyone at launch, so we don't double-send.
  notified_at timestamptz
);

-- One row per email address (case-insensitive) — repeat signups are no-ops.
create unique index if not exists waitlist_email_unique
  on public.waitlist (lower(email));

comment on table public.waitlist is
  'Pre-launch marketing waitlist. Written only via the service role (POST /api/waitlist). RLS on with no public policies — the list is not readable by the anon client.';

-- ── RLS ──────────────────────────────────────────────────────────────────────
-- No policies: the anon/auth clients get no access. The service role (used by
-- the API route) bypasses RLS entirely.
alter table public.waitlist enable row level security;
