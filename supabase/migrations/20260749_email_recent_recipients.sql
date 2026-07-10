-- Per-user "recent recipients" for the compose autocomplete.
--
-- Every time a user sends an email, each To/Cc recipient is recorded here (via
-- record_email_recipient). The compose recipient search then surfaces the
-- frequently-emailed addresses under a "Recent" group — so suppliers and other
-- one-off contacts that aren't clients or team members become one-click
-- selectable, ranked by how often / how recently they've been emailed.

create table if not exists public.email_recent_recipients (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  email        text not null,
  name         text,
  send_count   int  not null default 1,
  last_sent_at timestamptz not null default now(),
  created_at   timestamptz not null default now(),
  unique (user_id, email)
);

create index if not exists email_recent_recipients_user_idx
  on public.email_recent_recipients (user_id, send_count desc, last_sent_at desc);

alter table public.email_recent_recipients enable row level security;

drop policy if exists "recent recipients own" on public.email_recent_recipients;
create policy "recent recipients own" on public.email_recent_recipients
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Atomic upsert-increment: first send inserts, later sends bump the count +
-- last_sent_at and keep the best-known display name. SECURITY INVOKER so it
-- runs as the caller (auth.uid()) under the RLS policy above.
create or replace function public.record_email_recipient(p_email text, p_name text)
returns void
language sql
security invoker
as $$
  insert into public.email_recent_recipients (user_id, email, name)
  values (auth.uid(), lower(trim(p_email)), nullif(trim(coalesce(p_name, '')), ''))
  on conflict (user_id, email) do update
    set send_count   = public.email_recent_recipients.send_count + 1,
        last_sent_at = now(),
        name         = coalesce(excluded.name, public.email_recent_recipients.name);
$$;

grant execute on function public.record_email_recipient(text, text) to authenticated;
