-- Per-user ordered sidebar favourites (array of module IDs)
alter table users add column if not exists favourites jsonb not null default '[]'::jsonb;
