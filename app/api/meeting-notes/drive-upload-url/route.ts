/**
 * POST /api/meeting-notes/drive-upload-url
 *
 * Initiates a Google Drive resumable upload session for a meeting recording.
 * Returns the upload URL so the client can upload the video blob directly to
 * Google Drive — bypassing Next.js body-size limits entirely.
 *
 * Flow:
 *  1. Server gets Drive credentials and finds/creates the "Meeting Notes" folder
 *  2. Server calls the Drive API to start a resumable upload session
 *  3. Returns { uploadUrl, webViewLinkTemplate } to the client
 *  4. Client PUTs the video blob to uploadUrl (browser → Google Drive directly)
 *  5. After upload, client extracts file ID from the upload response and
 *     passes driveVideoUrl to the meeting-notes/save endpoint
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getUserContext } from '@/lib/getUserContext';
import { getRefreshedDriveCredentials } from '@/lib/vaultHelpers';
import { createFolderWithDrive } from '@/lib/googleDrive';

const BodySchema = z.object({
  filename: z.string().min(1),
  mimeType: z.string().default('video/webm'),
  /** File size in bytes — used for the Content-Length header in the resumable session */
  fileSize: z.number().optional(),
});

export async function POST(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  let body: unknown;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' }, { status: 400 });
  }

  const { filename, mimeType, fileSize } = parsed.data;

  const creds = await getRefreshedDriveCredentials(ctx.firmId);
  if (!creds) {
    return NextResponse.json({ error: 'Google Drive is not connected for your firm.' }, { status: 400 });
  }

  // Find or create "Meeting Notes" folder under the firm root
  let folderId: string | undefined = creds.rootFolderId ?? undefined;

  try {
    const searchRes = await creds.drive.files.list({
      q: `name='Meeting Notes' and mimeType='application/vnd.google-apps.folder' and trashed=false${folderId ? ` and '${folderId}' in parents` : ''}`,
      fields: 'files(id)',
      supportsAllDrives: true,
    });
    if (searchRes.data.files && searchRes.data.files.length > 0) {
      folderId = searchRes.data.files[0].id ?? folderId;
    } else {
      const newFolder = await createFolderWithDrive(creds.drive, {
        name: 'Meeting Notes',
        parentFolderId: folderId,
      });
      folderId = newFolder.id ?? folderId;
    }
  } catch {
    // Non-fatal — just upload to root if folder lookup fails
  }

  // Initiate a Google Drive resumable upload session.
  // We call the Drive REST API directly because the googleapis library doesn't
  // expose the session URL easily for resumable uploads.
  const metadata = {
    name: filename,
    ...(folderId ? { parents: [folderId] } : {}),
  };

  const initHeaders: Record<string, string> = {
    'Authorization': `Bearer ${creds.accessToken}`,
    'Content-Type': 'application/json; charset=UTF-8',
    'X-Upload-Content-Type': mimeType,
  };
  if (fileSize) {
    initHeaders['X-Upload-Content-Length'] = String(fileSize);
  }

  const initRes = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,webViewLink,name',
    {
      method: 'POST',
      headers: initHeaders,
      body: JSON.stringify(metadata),
    }
  );

  if (!initRes.ok) {
    const errText = await initRes.text();
    console.error('[drive-upload-url] session init failed:', errText);
    return NextResponse.json({ error: 'Failed to initiate Drive upload session.' }, { status: 502 });
  }

  const uploadUrl = initRes.headers.get('Location');
  if (!uploadUrl) {
    return NextResponse.json({ error: 'Drive did not return an upload URL.' }, { status: 502 });
  }

  return NextResponse.json({ uploadUrl });
}
