-- Personal calendar reminders (Google-Calendar-style).
-- Distinct from calendar events: standalone time-pointed items, private to the
-- creating user, never visible to teammates. Renders on the calendar with a
-- bell icon and fires a top-of-screen banner [lead_minutes] before remind_at.
create table if not exists calendar_personal_reminders (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references users(id) on delete cascade,
  firm_id       uuid not null references firms(id) on delete cascade,
  title         text not null,
  notes         text,
  remind_at     timestamptz not null,
  -- null = use the user's global default lead time from settings
  lead_minutes  int,
  dismissed_at  timestamptz,
  created_at    timestamptz default now()
);

create index if not exists calendar_personal_reminders_user_time_idx
  on calendar_personal_reminders(user_id, remind_at);

alter table calendar_personal_reminders enable row level security;

-- Strict per-user isolation — a reminder is only ever visible to its creator.
create policy "Users manage own personal reminders"
  on calendar_personal_reminders for all
  using  (user_id = auth.uid())
  with check (user_id = auth.uid());
