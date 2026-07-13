import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase-server';

// ─── /api/cron/email-attachments-cleanup ───────────────────────────────────
// Safety net for the transient staging buckets (large email attachments, and
// large source-document uploads from Capture → Drive). Staged files are normally
// deleted the moment a send / upload finishes, so these buckets should be empty
// almost all the time. This sweeps any orphans left behind when a user abandons
// a compose, or a request dies between staging and cleanup — anything older than
// 24h. Steady-state storage stays ~0.

export const maxDuration = 120;

const BUCKETS = ['email-attachments-staging', 'document-uploads-staging'];
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

// Match the other crons' auth pattern.
function isAuthorisedCron(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.warn('[email-attachments-cleanup] CRON_SECRET not set — allowing request.');
    return true;
  }
  return request.headers.get('authorization') === `Bearer ${secret}`;
}

export async function GET(request: Request) {
  if (!isAuthorisedCron(request)) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }

  const service = createServiceClient();
  const cutoffMs = Date.now() - MAX_AGE_MS;
  const isStale = (createdAt?: string | null) => !!createdAt && Date.parse(createdAt) < cutoffMs;

  // Sweep one bucket: paths are namespaced by uploader ("{uid}/{uuid}-name"), so
  // the root lists user folders; walk each and collect files older than the
  // cutoff, then remove them. Returns how many were removed.
  const sweepBucket = async (bucket: string): Promise<number> => {
    const { data: rootEntries, error: rootErr } = await service.storage.from(bucket).list('', { limit: 1000 });
    if (rootErr) {
      console.error(`[email-attachments-cleanup] list root (${bucket})`, rootErr);
      return 0;
    }

    const stalePaths: string[] = [];
    for (const entry of rootEntries ?? []) {
      // A null id marks a synthetic folder prefix (a user id); anything else is
      // an unexpected file sitting at the root.
      if (entry.id === null) {
        const { data: files } = await service.storage.from(bucket).list(entry.name, { limit: 1000 });
        for (const f of files ?? []) {
          if (f.id !== null && isStale(f.created_at)) stalePaths.push(`${entry.name}/${f.name}`);
        }
      } else if (isStale(entry.created_at)) {
        stalePaths.push(entry.name);
      }
    }

    if (stalePaths.length === 0) return 0;

    const { error: rmErr } = await service.storage.from(bucket).remove(stalePaths);
    if (rmErr) {
      console.error(`[email-attachments-cleanup] remove (${bucket})`, rmErr);
      return 0;
    }
    return stalePaths.length;
  };

  try {
    let removed = 0;
    for (const bucket of BUCKETS) removed += await sweepBucket(bucket);
    if (removed > 0) console.log(`[email-attachments-cleanup] removed ${removed} orphaned staged file(s)`);
    return NextResponse.json({ removed });
  } catch (err) {
    console.error('[email-attachments-cleanup]', err);
    return NextResponse.json({ error: 'Cleanup failed' }, { status: 500 });
  }
}
