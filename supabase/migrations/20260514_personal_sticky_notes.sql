-- Personal sticky notes — private per user, persist across sessions, float
-- on top of every page in the app. Powers the header sticky-note button.
create table if not exists personal_sticky_notes (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references users(id) on delete cascade,
  firm_id     uuid not null references firms(id) on delete cascade,
  -- Tiptap document JSON. Stored as jsonb so we can index/search later if needed.
  content     jsonb not null default '{}'::jsonb,
  position_x  int not null default 80,
  position_y  int not null default 80,
  width       int not null default 260,
  height      int not null default 220,
  -- Preset palette key, e.g. 'yellow', 'pink', 'blue', 'green', 'purple', 'gray'.
  color       text not null default 'yellow',
  -- Higher z_order = on top. Bumped when the user clicks/focuses a note.
  z_order     int not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists personal_sticky_notes_user_idx
  on personal_sticky_notes(user_id);

alter table personal_sticky_notes enable row level security;

-- Strict per-user isolation. A sticky note is only ever visible to its creator.
create policy "Users manage own sticky notes"
  on personal_sticky_notes for all
  using  (user_id = auth.uid())
  with check (user_id = auth.uid());
