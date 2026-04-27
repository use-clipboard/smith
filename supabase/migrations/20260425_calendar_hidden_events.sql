-- Per-event visibility overrides for admin users.
-- A row here means the event is hidden from all other team members.
create table if not exists calendar_hidden_events (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references users(id) on delete cascade,
  firm_id         uuid not null references firms(id) on delete cascade,
  google_event_id text not null,
  created_at      timestamptz default now(),
  unique(user_id, google_event_id)
);

create index if not exists calendar_hidden_events_user_idx
  on calendar_hidden_events(user_id);

alter table calendar_hidden_events enable row level security;

-- Users can only manage their own hidden-event entries
create policy "Users manage own hidden events"
  on calendar_hidden_events for all
  using  (user_id = auth.uid())
  with check (user_id = auth.uid());
