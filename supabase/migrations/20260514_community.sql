-- ── Community feature ──────────────────────────────────────────────────────
-- The first cross-firm feature in SMITH: all authenticated users can read
-- every post and comment regardless of which firm they belong to. Writes are
-- always scoped to the acting user, and only the author can edit/delete.

create table if not exists community_posts (
  id             uuid primary key default gen_random_uuid(),
  author_id      uuid not null references users(id) on delete cascade,
  title          text not null,
  body           text not null,
  category       text not null default 'general'
                 check (category in ('general', 'accountancy', 'smith', 'tech')),
  -- Cached counts so the feed query stays cheap (kept in sync by the API).
  like_count     int  not null default 0,
  comment_count  int  not null default 0,
  edited_at      timestamptz,
  created_at     timestamptz not null default now()
);
create index if not exists community_posts_created_idx  on community_posts(created_at desc);
create index if not exists community_posts_trending_idx on community_posts(like_count desc, created_at desc);
create index if not exists community_posts_category_idx on community_posts(category, created_at desc);
alter table community_posts enable row level security;

create policy "Authenticated users can read all community posts"
  on community_posts for select using (auth.uid() is not null);
create policy "Users can insert their own posts"
  on community_posts for insert with check (author_id = auth.uid());
create policy "Authors can update their own posts"
  on community_posts for update using (author_id = auth.uid()) with check (author_id = auth.uid());
create policy "Authors can delete their own posts"
  on community_posts for delete using (author_id = auth.uid());

create table if not exists community_comments (
  id          uuid primary key default gen_random_uuid(),
  post_id     uuid not null references community_posts(id) on delete cascade,
  author_id   uuid not null references users(id) on delete cascade,
  body        text not null,
  like_count  int  not null default 0,
  edited_at   timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists community_comments_post_idx on community_comments(post_id, created_at);
alter table community_comments enable row level security;

create policy "Authenticated users can read all community comments"
  on community_comments for select using (auth.uid() is not null);
create policy "Users can insert their own comments"
  on community_comments for insert with check (author_id = auth.uid());
create policy "Authors can update their own comments"
  on community_comments for update using (author_id = auth.uid()) with check (author_id = auth.uid());
create policy "Authors can delete their own comments"
  on community_comments for delete using (author_id = auth.uid());

-- Likes — one row per (target, user). Inserting and deleting are idempotent
-- enough for the toggle UX; we increment/decrement like_count from the API.
create table if not exists community_post_likes (
  post_id    uuid not null references community_posts(id) on delete cascade,
  user_id    uuid not null references users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);
alter table community_post_likes enable row level security;
create policy "Authenticated users can read post likes"
  on community_post_likes for select using (auth.uid() is not null);
create policy "Users can like as themselves"
  on community_post_likes for insert with check (user_id = auth.uid());
create policy "Users can remove their own likes"
  on community_post_likes for delete using (user_id = auth.uid());

create table if not exists community_comment_likes (
  comment_id uuid not null references community_comments(id) on delete cascade,
  user_id    uuid not null references users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (comment_id, user_id)
);
alter table community_comment_likes enable row level security;
create policy "Authenticated users can read comment likes"
  on community_comment_likes for select using (auth.uid() is not null);
create policy "Users can like comments as themselves"
  on community_comment_likes for insert with check (user_id = auth.uid());
create policy "Users can remove their own comment likes"
  on community_comment_likes for delete using (user_id = auth.uid());

-- Reports — queue for the SMITH team to review. No public read.
create table if not exists community_reports (
  id          uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references users(id) on delete cascade,
  post_id     uuid references community_posts(id) on delete cascade,
  comment_id  uuid references community_comments(id) on delete cascade,
  reason      text,
  created_at  timestamptz not null default now()
);
alter table community_reports enable row level security;
create policy "Users can submit reports"
  on community_reports for insert with check (reporter_id = auth.uid());
-- No select policy — only the SMITH team (via service role) reviews these.

-- Per-user opt-out for community reply notifications. Defaults to enabled so
-- users discover the feature; the Settings → Community toggle flips this.
alter table users
  add column if not exists community_notifications_enabled boolean not null default true;
