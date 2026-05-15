-- MTD IT — source document storage bucket
--
-- Stores the raw files uploaded during the per-quarter Analyse step so the
-- user can later "View source" against any extracted entry. Bucket is
-- PRIVATE; the API mediates access via signed URLs and the service-role
-- client.
--
-- Path convention written by the analyse API:
--   {quarter_id}/{document_id}_{original-filename}
-- (no firm prefix needed — the API enforces firm scope before signing.)
--
-- Some Supabase setups can create buckets via SQL; others require the
-- dashboard. The INSERT below is idempotent (`ON CONFLICT DO NOTHING`).
-- If your project's storage permissions block it, create the bucket
-- manually in the Supabase dashboard with the same name + `public=false`,
-- then skip just the INSERT and run the rest.

insert into storage.buckets (id, name, public)
values ('mtd-it-source-docs', 'mtd-it-source-docs', false)
on conflict (id) do nothing;

-- No RLS policies are added for this bucket on purpose. Without an explicit
-- SELECT/INSERT policy on storage.objects for bucket_id = 'mtd-it-source-docs',
-- direct end-user reads/writes are denied (Supabase storage is default-deny).
-- The MTD IT API routes use the service-role client, which bypasses RLS, so
-- they can read/write freely while the API enforces firm-scope before
-- handing back signed URLs.
