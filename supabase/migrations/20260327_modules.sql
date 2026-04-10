-- ============================================================
-- Agent Smith — Modular Tool Architecture
-- Adds active_modules and seat_count to the firms table.
-- Run this in the Supabase SQL Editor.
-- ============================================================

-- Add active modules list and seat count to firms
alter table public.firms
  add column if not exists active_modules text[] not null default '{}',
  add column if not exists seat_count integer not null default 1;

-- For existing firms (Phase 1 — internal use), activate all optional modules.
-- New firms created after this migration will start with an empty array
-- and have modules assigned during onboarding (Phase 2).
update public.firms
set active_modules = array[
  'full-analysis',
  'bank-to-csv',
  'landlord',
  'final-accounts',
  'performance',
  'p32',
  'risk-assessment',
  'summarise',
  'document-vault',
  'google-drive',
  'policies'
]
where active_modules = '{}';

-- Index for array containment queries (used by module checks)
create index if not exists firms_active_modules_gin
  on public.firms using gin(active_modules);
