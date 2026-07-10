-- Transient staging bucket for large email attachments.
--
-- Why: the /api/email/send serverless function has a ~4.5 MB request-body cap,
-- so anything bigger dies with a 413 before it reaches Gmail. Instead, the
-- browser uploads large attachments DIRECTLY to this bucket (bypassing the cap),
-- and the send route pulls them back with the service-role key, attaches them to
-- the Gmail message, sends, then deletes the staged copy. Files over 25 MB take
-- a different path (uploaded to the firm's Google Drive as a shareable link) but
-- still transit this bucket on the way.
--
-- This is a STAGING area, not permanent storage: files live here for the length
-- of one email send (seconds) and are deleted immediately afterwards. A nightly
-- cron (/api/cron/email-attachments-cleanup) sweeps any orphans older than 24h,
-- so steady-state usage is effectively zero.

insert into storage.buckets (id, name, public)
values ('email-attachments-staging', 'email-attachments-staging', false)
on conflict (id) do nothing;

-- Browser uploads use the anon client with the signed-in user's session, so we
-- need RLS policies on storage.objects. Files are namespaced by the uploader's
-- user id (path = "{auth.uid()}/{uuid}-{filename}") and each user can only touch
-- their own folder. The send/drive-upload routes read + delete via the
-- service-role client, which bypasses RLS.
drop policy if exists "email staging insert own" on storage.objects;
create policy "email staging insert own" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'email-attachments-staging'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "email staging select own" on storage.objects;
create policy "email staging select own" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'email-attachments-staging'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "email staging delete own" on storage.objects;
create policy "email staging delete own" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'email-attachments-staging'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
