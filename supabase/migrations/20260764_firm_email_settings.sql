-- Email — firm-wide defaults for outgoing mail.
--
-- Currently just the default font: the house font every compose window starts
-- in, so a firm's client email looks consistent without each user picking one.
-- Senders can still override it per email from the compose toolbar; that choice
-- rides in the message body and is never stored here.
--
-- One row per firm. Its own table rather than a column on `firms` so later
-- email branding (colours, header/footer) has somewhere to land.

create table if not exists public.firm_email_settings (
  firm_id      uuid primary key references public.firms(id) on delete cascade,
  -- An id from EMAIL_FONTS in lib/emailFonts.ts, not a CSS stack — the stack is
  -- resolved at send time so it can be corrected without a data migration.
  default_font text not null default 'arial',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

comment on table public.firm_email_settings is
  'Firm-wide defaults for outgoing user email. default_font is an id from lib/emailFonts.ts (web-safe stacks only).';

alter table public.firm_email_settings enable row level security;

-- Readable by the whole firm (every compose window needs it); writes are
-- additionally gated to admins in the API route.
drop policy if exists "firm_email_settings: same firm" on public.firm_email_settings;
create policy "firm_email_settings: same firm"
  on public.firm_email_settings for all
  using (firm_id = public.my_firm_id())
  with check (firm_id = public.my_firm_id());
