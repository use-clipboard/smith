import { fileToBase64 } from '@/utils/fileUtils';
import { createClient as createBrowserSupabase } from '@/lib/supabase';

// Shared client-side helpers for saving source documents / reports to Google
// Drive via /api/documents/upload.
//
// The upload route runs on a serverless function with a ~4.5 MB request-body
// cap. Sending files inline as base64 (~1.37× their bytes) blows past that for
// large scans, producing a plain-text 413 the client used to JSON.parse into the
// confusing "not valid JSON" error. So large files are uploaded DIRECTLY to a
// Supabase Storage bucket from the browser (bypassing the cap), and only their
// object path is sent — the route pulls each back server-side. Small files still
// go inline. Requires migration 20260757 (document-uploads-staging).
//
// The cap is on the WHOLE request body, not per file — so it isn't enough to
// stage only individually-large files. A batch of many small scans (e.g. 14
// invoices at ~0.4 MB each) is under INLINE_LIMIT per file yet blows the cap in
// aggregate, giving a deterministic 413 that retrying never fixes. So we also
// track a running total of inline (encoded) bytes and stage files once that
// budget is reached, keeping the request body safely under the cap no matter how
// many files there are.

const INLINE_LIMIT = 3 * 1024 * 1024; // per-file: anything bigger always stages
// Whole-request budget for inline base64 (encoded bytes). Kept well under the
// ~4.5 MB platform cap to leave headroom for JSON structure, names and metadata.
const TOTAL_INLINE_ENCODED_BUDGET = 3.5 * 1024 * 1024;
const STAGING_BUCKET = 'document-uploads-staging';

/** Approx base64-encoded size of a file of `bytes` raw bytes (4 chars per 3 bytes). */
const estimateEncodedSize = (bytes: number) => Math.ceil(bytes / 3) * 4;

/** A file for /api/documents/upload — either inline (base64) or staged (stagePath). */
export type DriveUploadFile = { name: string; mimeType: string; base64?: string; stagePath?: string };

/**
 * Retry a transient network failure ("Failed to fetch" — an offline blip, a
 * dropped connection or an edge reset) a couple of times before giving up.
 * Only network-level TypeErrors are retried; a real HTTP error response is
 * returned as-is for the caller to handle (readUploadError). This is what makes
 * "the Drive save sometimes fails with Failed to fetch" recover on its own.
 */
function isTransientNetworkError(err: unknown): boolean {
  return err instanceof TypeError; // fetch() rejects with a TypeError on network failure
}

export async function fetchWithRetry(input: RequestInfo | URL, init?: RequestInit, attempts = 3): Promise<Response> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fetch(input, init);
    } catch (err) {
      lastErr = err;
      if (!isTransientNetworkError(err) || i === attempts - 1) break;
      await new Promise(r => setTimeout(r, 400 * (i + 1)));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('Network request failed');
}

/** Upload one File to the transient staging bucket; returns its object path.
 *  Retries transient network failures — the browser→Storage upload is the other
 *  place a "Failed to fetch" can strike for a large scan. */
async function stageFileToBucket(file: File): Promise<string> {
  const supabase = createBrowserSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not signed in');
  const safeName = file.name.replace(/[^\w.\-]+/g, '_').slice(-120);
  const path = `${user.id}/${crypto.randomUUID()}-${safeName}`;
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const { error } = await supabase.storage
        .from(STAGING_BUCKET)
        .upload(path, file, { contentType: file.type || 'application/octet-stream', upsert: true });
      if (error) throw new Error(error.message);
      return path;
    } catch (err) {
      lastErr = err;
      if (!isTransientNetworkError(err) || attempt === 2) break;
      await new Promise(r => setTimeout(r, 400 * (attempt + 1)));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('Could not stage the file for upload');
}

/**
 * Encode files for /api/documents/upload: files are staged in Storage and sent
 * as a path when they're individually large OR when adding them inline would push
 * the request body over the budget; otherwise they go inline as base64. Either
 * way the route ends up with the full original file.
 *
 * Runs sequentially (not Promise.all) so the running inline-byte total is
 * accounted for deterministically — concurrent callbacks would all read the same
 * pre-update total and defeat the budget.
 */
export async function encodeFilesForDriveUpload(files: File[]): Promise<DriveUploadFile[]> {
  let inlineEncoded = 0;
  const encoded: DriveUploadFile[] = [];
  for (const f of files) {
    const base = { name: f.name, mimeType: f.type || 'application/pdf' };
    const encodedSize = estimateEncodedSize(f.size);
    if (f.size > INLINE_LIMIT || inlineEncoded + encodedSize > TOTAL_INLINE_ENCODED_BUDGET) {
      encoded.push({ ...base, stagePath: await stageFileToBucket(f) });
    } else {
      inlineEncoded += encodedSize;
      encoded.push({ ...base, base64: await fileToBase64(f) });
    }
  }
  return encoded;
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
      ? 'The source files were too large to send in one request. Try saving fewer documents at a time, or contact support if this keeps happening.'
      : `The server returned an unexpected response (status ${res.status}). Please try again.`;
  }
}
