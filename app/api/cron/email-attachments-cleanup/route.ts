import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase-server';

// ─── /api/cron/email-attachments-cleanup ───────────────────────────────────
// Safety net for the email large-attachment staging bucket. Staged files are
// normally deleted the moment a send (or Drive upload) finishes, so this bucket
// should be empty almost all the time. This sweeps any orphans left behind when
// a user attaches a file then abandons the compose, or a send dies between
// staging and cleanup — anything older than 24h. Steady-state storage stays ~0.

export const maxDuration = 120;

const BUCKET = 'email-attachments-staging';
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

  try {
    // Paths are namespaced by uploader ("{uid}/{uuid}-name"), so the bucket root
    // lists user folders; we walk each and collect files older than the cutoff.
    const { data: rootEntries, error: rootErr } = await service.storage.from(BUCKET).list('', { limit: 1000 });
    if (rootErr) {
      console.error('[email-attachments-cleanup] list root', rootErr);
      return NextResponse.json({ error: 'Failed to list bucket' }, { status: 500 });
    }

    const stalePaths: string[] = [];
    for (const entry of rootEntries ?? []) {
      // A null id marks a synthetic folder prefix (a user id); anything else is
      // an unexpected file sitting at the root.
      if (entry.id === null) {
        const { data: files } = await service.storage.from(BUCKET).list(entry.name, { limit: 1000 });
        for (const f of files ?? []) {
          if (f.id !== null && isStale(f.created_at)) stalePaths.push(`${entry.name}/${f.name}`);
        }
      } else if (isStale(entry.created_at)) {
        stalePaths.push(entry.name);
      }
    }

    if (stalePaths.length === 0) return NextResponse.json({ removed: 0 });

    const { error: rmErr } = await service.storage.from(BUCKET).remove(stalePaths);
    if (rmErr) {
      console.error('[email-attachments-cleanup] remove', rmErr);
      return NextResponse.json({ error: 'Failed to remove staged objects' }, { status: 500 });
    }

    console.log(`[email-attachments-cleanup] removed ${stalePaths.length} orphaned staged attachment(s)`);
    return NextResponse.json({ removed: stalePaths.length });
  } catch (err) {
    console.error('[email-attachments-cleanup]', err);
    return NextResponse.json({ error: 'Cleanup failed' }, { status: 500 });
  }
}
