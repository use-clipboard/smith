-- ============================================================
--  Dashboard whiteboard — drag + marker pen support
-- ============================================================
--  Upgrades the firm-wide noticeboard (whiteboard_messages) to
--  match the per-book whiteboard:
--
--    • A `kind` discriminator: 'sticky' (existing notes) or
--      'marker' (handwritten marker-pen text).
--    • Per-note position stored as % of board width/height so
--      notes are draggable and stay sensibly placed across
--      viewport sizes.
--    • Sticky rotation kept on the row for parity with the book
--      board (the dashboard previously computed it from the id).
--    • Extends the colour check to include marker colours
--      (black/red — blue is shared with stickies).
-- ============================================================

alter table public.whiteboard_messages
  add column if not exists kind     text not null default 'sticky'
    check (kind in ('sticky', 'marker'));

alter table public.whiteboard_messages
  add column if not exists pos_x    numeric(6,2) not null default 50;

alter table public.whiteboard_messages
  add column if not exists pos_y    numeric(6,2) not null default 30;

alter table public.whiteboard_messages
  add column if not exists rotation numeric(5,2) not null default 0;

-- Replace the colour check so markers (black / blue / red) are valid
-- alongside the sticky palette (yellow / pink / blue / green).
do $$
begin
  alter table public.whiteboard_messages drop constraint whiteboard_messages_color_check;
exception
  when others then null;
end $$;

alter table public.whiteboard_messages
  add constraint whiteboard_messages_color_check
  check (color in ('yellow', 'pink', 'blue', 'green', 'black', 'red'));

-- Seed positions for existing rows so they don't all stack at 50/30.
-- Spread them across a 3-column grid based on insertion order.
with ranked as (
  select id,
         (row_number() over (partition by firm_id order by created_at)) - 1 as idx
  from public.whiteboard_messages
  where pos_x = 50 and pos_y = 30
)
update public.whiteboard_messages w
   set pos_x = 15 + ((ranked.idx % 4) * 22),
       pos_y = 12 + (floor(ranked.idx / 4) * 32)
  from ranked
 where w.id = ranked.id;
