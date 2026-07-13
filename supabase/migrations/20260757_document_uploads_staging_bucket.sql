-- Transient staging bucket for large source-document uploads (Capture → Drive).
--
-- Why: the /api/documents/upload serverless function has a ~4.5 MB request-body
-- cap, so saving a large scanned PDF (base64 inflates it ~1.37×) dies with a 413
-- before it reaches Google Drive. Instead, the browser uploads large files
-- DIRECTLY to this bucket (bypassing the cap), sends just the object path, and
-- the upload route pulls each file back with the service-role key, pushes it to
-- the firm's Drive, then deletes the staged copy.
--
-- This is a STAGING area, not permanent storage: files live here for the length
-- of one save (seconds) and are deleted immediately afterwards. Mirrors the
-- email-attachments-staging bucket exactly.

insert into storage.buckets (id, name, public)
values ('document-uploads-staging', 'document-uploads-staging', false)
on conflict (id) do nothing;

-- Browser uploads use the anon client with the signed-in user's session, so we
-- need RLS policies on storage.objects. Files are namespaced by the uploader's
-- user id (path = "{auth.uid()}/{uuid}-{filename}") and each user can only touch
-- their own folder. The upload route reads + deletes via the service-role
-- client, which bypasses RLS.
drop policy if exists "document staging insert own" on storage.objects;
create policy "document staging insert own" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'document-uploads-staging'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "document staging select own" on storage.objects;
create policy "document staging select own" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'document-uploads-staging'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "document staging delete own" on storage.objects;
create policy "document staging delete own" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'document-uploads-staging'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
