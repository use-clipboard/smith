/**
 * POST /api/meeting-notes/upload-recording
 *
 * Receives a raw video blob from the browser and uploads it directly to Google
 * Drive via the googleapis library (server-side resumable upload).
 *
 * Metadata is passed as request headers to avoid multipart parsing overhead
 * and to keep the body a plain stream that googleapis can pipe directly to Drive.
 *
 * Headers:
 *   Content-Type       — video MIME type (e.g. video/webm)
 *   X-Filename         — desired filename in Drive
 *   X-Folder-Id        — (optional) explicit Drive folder ID to upload into
 *   X-Client-Code      — (optional) client ref; triggers auto folder path creation
 *   X-Meeting-Date     — (optional) date string used as deepest folder name
 *
 * Folder logic:
 *   • X-Folder-Id provided  → upload there directly
 *   • X-Client-Code provided → find/create:  root / {ClientCode} / Meeting Notes / {Date}
 *   • Neither               → find/create:  root / Meeting Notes
 */
import { NextRequest, NextResponse } from 'next/server';
import { Readable } from 'stream';
import { getUserContext } from '@/lib/getUserContext';
import { getRefreshedDriveCredentials } from '@/lib/vaultHelpers';
import type { drive_v3 } from 'googleapis';

export const maxDuration = 300; // 5 minutes — large recordings need time

// ── Helpers ───────────────────────────────────────────────────────────────────

type DriveClient = drive_v3.Drive;

/**
 * Walks a list of folder name segments under a root folder, finding or
 * creating each one in turn. Returns the ID of the deepest folder.
 */
async function ensureFolderPath(
  drive: DriveClient,
  rootId: string,
  segments: string[],
): Promise<string> {
  let parentId = rootId;
  for (const segment of segments) {
    const safe = segment.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    const search = await drive.files.list({
      q: `name='${safe}' and mimeType='application/vnd.google-apps.folder' and '${parentId}' in parents and trashed=false`,
      fields: 'files(id)',
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });
    if (search.data.files?.length) {
      parentId = search.data.files[0].id!;
    } else {
      const created = await drive.files.create({
        requestBody: {
          name: segment,
          mimeType: 'application/vnd.google-apps.folder',
          parents: [parentId],
        },
        fields: 'id',
        supportsAllDrives: true,
      });
      parentId = created.data.id!;
    }
  }
  return parentId;
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const mimeType   = req.headers.get('content-type') ?? 'video/webm';
  const filename   = req.headers.get('x-filename')    ?? 'recording.webm';
  const folderId   = req.headers.get('x-folder-id')   || null;
  const clientCode = req.headers.get('x-client-code') || null;
  const meetingDate = req.headers.get('x-meeting-date') || null;

  const creds = await getRefreshedDriveCredentials(ctx.firmId);
  if (!creds) {
    return NextResponse.json({ error: 'Google Drive is not connected for your firm.' }, { status: 400 });
  }

  if (!req.body) {
    return NextResponse.json({ error: 'No recording data received.' }, { status: 400 });
  }

  try {
    // ── Determine target folder ───────────────────────────────────────────────
    let targetFolderId: string | null = folderId;

    if (!targetFolderId && creds.rootFolderId) {
      if (clientCode) {
        // root / {ClientCode} / Meeting Notes / {Date}
        const segments = [clientCode, 'Meeting Notes'];
        if (meetingDate) segments.push(meetingDate);
        targetFolderId = await ensureFolderPath(creds.drive, creds.rootFolderId, segments);
      } else {
        // root / Meeting Notes
        targetFolderId = await ensureFolderPath(creds.drive, creds.rootFolderId, ['Meeting Notes']);
      }
    }

    // ── Stream body directly to Drive ─────────────────────────────────────────
    // Readable.fromWeb converts the Web ReadableStream to a Node.js Readable
    // so the googleapis library can pipe it to Drive without buffering the whole
    // file in memory.
    const nodeStream = Readable.fromWeb(
      req.body as Parameters<typeof Readable.fromWeb>[0],
    );

    const driveRes = await creds.drive.files.create({
      requestBody: {
        name: filename,
        ...(targetFolderId ? { parents: [targetFolderId] } : {}),
      },
      media: {
        mimeType,
        body: nodeStream,
      },
      fields: 'id,webViewLink,name',
      supportsAllDrives: true,
    });

    const fileId  = driveRes.data.id ?? '';
    const driveUrl = driveRes.data.webViewLink
      ?? (fileId ? `https://drive.google.com/file/d/${fileId}/view` : null);

    return NextResponse.json({ driveUrl, fileId });
  } catch (err) {
    console.error('[upload-recording]', err);
    return NextResponse.json(
      { error: 'Failed to upload recording to Drive. Please try again.' },
      { status: 500 },
    );
  }
}
