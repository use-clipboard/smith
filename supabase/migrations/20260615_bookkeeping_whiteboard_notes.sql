-- ============================================================
--  Bookkeeping — per-book whiteboard notes
-- ============================================================
--  Replaces the static "Getting Started" panel on the book's Home
--  tab with a shared, free-form whiteboard:
--
--    • Sticky notes (yellow/pink/blue/green) — draggable by the
--      magnet at the top.
--    • Marker text (black/blue/red) — handwritten-style scrawls
--      typed directly on the board, draggable anywhere.
--    • Eraser tool (in the corner) — click to switch the cursor,
--      then click anything to delete it.
--    • Live for every user with access to the book via Supabase
--      realtime.
--
--  Single table with a 'kind' discriminator keeps the API simple.
--  Positions are stored as percentages (0-100) of the whiteboard's
--  visible area, so notes stay sensibly placed as the canvas
--  resizes with the viewport.
-- ============================================================

create table if not exists public.bookkeeping_whiteboard_notes (
  id            uuid primary key default gen_random_uuid(),
  book_id       uuid not null references public.bookkeeping_books(id) on delete cascade,

  -- 'sticky' = paper-style note with magnet; 'marker' = bare handwritten text.
  kind          text not null check (kind in ('sticky', 'marker')),

  content       text not null default '',

  -- Palette varies by kind (validated in the app layer to keep this column
  -- flexible for future colour additions):
  --   • sticky kind  → yellow | pink | blue | green
  --   • marker kind  → black | blue | red
  color         text not null default 'yellow',

  -- Position on the board as % of width / height. Lets the layout scale
  -- gracefully across viewport sizes.
  pos_x         numeric(6,2) not null default 50,
  pos_y         numeric(6,2) not null default 50,

  -- Stickies render at a small ±deg rotation so they look pinned-up rather
  -- than pixel-perfect. Markers always sit at 0.
  rotation      numeric(5,2) not null default 0,

  author_id     uuid references public.users(id) on delete set null,
  author_name   text,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists bookkeeping_whiteboard_notes_book_idx
  on public.bookkeeping_whiteboard_notes (book_id, created_at desc);

comment on table public.bookkeeping_whiteboard_notes is
  'Per-book whiteboard for free-form team notes — sticky paper notes and bare marker text. Realtime-synced via the Supabase channel `book-whiteboard:<book_id>`.';

alter table public.bookkeeping_whiteboard_notes enable row level security;

-- Same firm-scoped policy pattern as bookkeeping_vat_returns / matches.
create policy "whiteboard_notes_select_same_firm"
  on public.bookkeeping_whiteboard_notes for select
  using (
    exists (
      select 1 from public.bookkeeping_books b
      where b.id = bookkeeping_whiteboard_notes.book_id
        and b.firm_id = public.my_firm_id()
    )
  );

create policy "whiteboard_notes_modify_same_firm"
  on public.bookkeeping_whiteboard_notes for all
  using (
    exists (
      select 1 from public.bookkeeping_books b
      where b.id = bookkeeping_whiteboard_notes.book_id
        and b.firm_id = public.my_firm_id()
    )
  )
  with check (
    exists (
      select 1 from public.bookkeeping_books b
      where b.id = bookkeeping_whiteboard_notes.book_id
        and b.firm_id = public.my_firm_id()
    )
  );

-- Enable realtime broadcasting (the dashboard whiteboard already uses this
-- mechanism). Best-effort — if the publication doesn't exist yet, ignore.
do $$
begin
  alter publication supabase_realtime add table public.bookkeeping_whiteboard_notes;
exception
  when others then null;
end $$;
