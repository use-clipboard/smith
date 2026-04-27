-- Google Calendar integration tables

-- Per-user Google Calendar OAuth tokens
create table if not exists calendar_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  google_access_token text,
  google_refresh_token text,
  google_token_expiry timestamptz,
  google_email text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(user_id)
);

-- Per-firm, per-user calendar visibility settings (admin-controlled)
create table if not exists calendar_visibility (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references firms(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  visible_to_team bool not null default true,
  editable_by_team bool not null default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(firm_id, user_id)
);

-- RLS
alter table calendar_tokens enable row level security;
alter table calendar_visibility enable row level security;

-- Users can only read/write their own tokens
create policy "Users manage own calendar tokens"
  on calendar_tokens for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- All firm members can read visibility settings
create policy "Firm members can read calendar visibility"
  on calendar_visibility for select
  using (
    firm_id in (select firm_id from users where id = auth.uid())
  );

-- Admins can insert/update/delete visibility settings
create policy "Admins manage calendar visibility"
  on calendar_visibility for insert
  with check (
    firm_id in (select firm_id from users where id = auth.uid() and role = 'admin')
  );

create policy "Admins update calendar visibility"
  on calendar_visibility for update
  using (
    firm_id in (select firm_id from users where id = auth.uid() and role = 'admin')
  );

create policy "Admins delete calendar visibility"
  on calendar_visibility for delete
  using (
    firm_id in (select firm_id from users where id = auth.uid() and role = 'admin')
  );
