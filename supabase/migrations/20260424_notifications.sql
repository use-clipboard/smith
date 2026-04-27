-- Notifications table for in-app alerts
create table if not exists notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  firm_id uuid not null references firms(id) on delete cascade,
  type text not null default 'general',
  title text not null,
  body text,
  data jsonb,
  read bool not null default false,
  created_at timestamptz default now()
);

create index if not exists notifications_user_id_idx on notifications(user_id);
create index if not exists notifications_user_unread_idx on notifications(user_id, read) where read = false;

alter table notifications enable row level security;

-- Users can only read their own notifications
create policy "Users read own notifications"
  on notifications for select
  using (user_id = auth.uid());

-- Users can mark their own notifications as read
create policy "Users update own notifications"
  on notifications for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Users can delete their own notifications
create policy "Users delete own notifications"
  on notifications for delete
  using (user_id = auth.uid());
