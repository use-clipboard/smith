-- ============================================================
--  mtd_it_entries.source — provenance marker for imported entries
-- ============================================================
--  Lets an import (e.g. the Landlord Analysis feed) tag the entries
--  it creates so a re-import can REPLACE its own prior entries
--  without touching manually-added or other-sourced rows.
--
--  Values in use: 'landlord' (Landlord → MTD IT feed). Null for
--  manual/AI-scanned entries and existing rows.
-- ============================================================

alter table public.mtd_it_entries
  add column if not exists source text;

create index if not exists mtd_it_entries_source_idx
  on public.mtd_it_entries(quarter_id, source);
