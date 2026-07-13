import { fileToBase64 } from '@/utils/fileUtils';
import { createClient as createBrowserSupabase } from '@/lib/supabase';

// Shared client-side helpers for saving source documents / reports to Google
// Drive via /api/documents/upload.
//
// The upload route runs on a serverless function with a ~4.5 MB request-body
// cap. Sending files inline as base64 (~1.37× their bytes) blows past that for
// large scans, producing a plain-text 413 the client used to JSON.parse into the
// confusing "not valid JSON" error. So anything over INLINE_LIMIT is uploaded
// DIRECTLY to a Supabase Storage bucket from the browser (bypassing the cap),
// and only its object path is sent — the route pulls it back server-side. Small
// files still go inline. Requires migration 20260757 (document-uploads-staging).

const INLINE_LIMIT = 3 * 1024 * 1024; // ~3 MB raw → ~4 MB encoded, safely under the cap
const STAGING_BUCKET = 'document-uploads-staging';

/** A file for /api/documents/upload — either inline (base64) or staged (stagePath). */
export type DriveUploadFile = { name: string; mimeType: string; base64?: string; stagePath?: string };

/** Upload one File to the transient staging bucket; returns its object path. */
async function stageFileToBucket(file: File): Promise<string> {
  const supabase = createBrowserSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not signed in');
  const safeName = file.name.replace(/[^\w.\-]+/g, '_').slice(-120);
  const path = `${user.id}/${crypto.randomUUID()}-${safeName}`;
  const { error } = await supabase.storage
    .from(STAGING_BUCKET)
    .upload(path, file, { contentType: file.type || 'application/octet-stream', upsert: false });
  if (error) throw new Error(error.message);
  return path;
}

/**
 * Encode files for /api/documents/upload: large files are staged in Storage and
 * sent as a path; small files go inline as base64. Either way the route ends up
 * with the full original file.
 */
export async function encodeFilesForDriveUpload(files: File[]): Promise<DriveUploadFile[]> {
  return Promise.all(files.map(async (f) => {
    const base = { name: f.name, mimeType: f.type || 'application/pdf' };
    if (f.size > INLINE_LIMIT) return { ...base, stagePath: await stageFileToBucket(f) };
    return { ...base, base64: await fileToBase64(f) };
  }));
}

/**
 * Read a non-OK upload response defensively. The body isn't guaranteed to be
 * JSON — a platform-level 413 (body over the limit) or a proxy error returns
 * plain text — so read it as text first, then try to parse.
 */
export async function readUploadError(res: Response): Promise<string> {
  const raw = await res.text();
  try {
    return (JSON.parse(raw) as { error?: string }).error || 'Drive upload failed';
  } catch {
    return res.status === 413
      ? 'One of the files is too large to save to Drive. Please try again — large files are now uploaded directly, so a retry usually succeeds.'
      : `The server returned an unexpected response (status ${res.status}). Please try again.`;
  }
}
