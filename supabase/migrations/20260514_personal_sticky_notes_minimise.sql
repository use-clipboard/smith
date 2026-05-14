-- Per-note minimise state for personal sticky notes.
-- A minimised note is hidden from the floating layer but kept in the user's
-- list — restored from the header submenu by clicking its title.
alter table personal_sticky_notes
  add column if not exists is_minimised boolean not null default false;
