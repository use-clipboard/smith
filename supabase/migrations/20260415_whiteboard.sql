-- Whiteboard messages (team noticeboard on the dashboard)
create table if not exists whiteboard_messages (
  id           uuid primary key default gen_random_uuid(),
  firm_id      uuid not null references firms(id) on delete cascade,
  user_id      uuid references users(id) on delete set null,
  author_name  text not null default '',
  content      text not null,
  color        text not null default 'yellow' check (color in ('yellow', 'pink', 'blue')),
  created_at   timestamptz default now()
);

alter table whiteboard_messages enable row level security;

-- All firm members can read their firm's notes
create policy "whiteboard_select"
  on whiteboard_messages for select
  using (firm_id = (select firm_id from users where id = auth.uid()));

-- Firm members can insert notes for their own firm
create policy "whiteboard_insert"
  on whiteboard_messages for insert
  with check (
    firm_id = (select firm_id from users where id = auth.uid())
    and user_id = auth.uid()
  );

-- Users can only update their own notes
create policy "whiteboard_update"
  on whiteboard_messages for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Users can only delete their own notes
create policy "whiteboard_delete"
  on whiteboard_messages for delete
  using (user_id = auth.uid());

-- Index for fast firm-scoped queries
create index whiteboard_messages_firm_idx on whiteboard_messages(firm_id, created_at desc);
