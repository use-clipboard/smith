-- ============================================================
-- Dashboard — Per-user customizable layout
-- Stores an ordered array of visible widget ids. Order = display
-- order; absence from the array = hidden. Backfills existing rows
-- with the default layout so everyone starts with the standard set.
-- ============================================================

alter table public.users
  add column if not exists dashboard_layout jsonb not null
  default '["whiteboard","recent-clients","recent-activity","team","quick-launch"]'::jsonb;

comment on column public.users.dashboard_layout is
  'Per-user dashboard layout: ordered array of visible widget ids (see config/dashboardWidgets.ts).';
