/**
 * POST /api/meeting-notes/save-pdf-to-drive
 *
 * Generates the meeting notes PDF server-side and uploads it directly to
 * Google Drive — no round-trip through the browser.
 *
 * Body (JSON):
 *   • ...MeetingPDFSchema fields (same as download-pdf)
 *   • folderId?    — explicit Drive folder ID (user picked via folder picker)
 *   • clientCode?  — triggers auto folder path: root / {ClientCode} / Meeting Notes / {date}
 *   • meetingDate  — already in the PDF schema; also used as the deepest folder name
 */
import { NextRequest, NextResponse } from 'next/server';
import { Readable } from 'stream';
import { z } from 'zod';
import { getUserContext } from '@/lib/getUserContext';
import { getRefreshedDriveCredentials } from '@/lib/vaultHelpers';
import { generateMeetingPDF, MeetingPDFSchema } from '@/lib/meetingPDF';
import type { drive_v3 } from 'googleapis';

export const maxDuration = 60;

// ── Folder helper (same logic as upload-recording) ────────────────────────────

type DriveClient = drive_v3.Drive;

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

// ── Schema ────────────────────────────────────────────────────────────────────

const BodySchema = MeetingPDFSchema.extend({
  folderId:   z.string().optional(),
  clientCode: z.string().optional(),
});

// ── Handler ───────────────────────────────────────────────────────────────────

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

  const { folderId, clientCode, ...pdfData } = parsed.data;

  const creds = await getRefreshedDriveCredentials(ctx.firmId);
  if (!creds) {
    return NextResponse.json({ error: 'Google Drive is not connected for your firm.' }, { status: 400 });
  }

  try {
    // ── Determine target folder ───────────────────────────────────────────────
    let targetFolderId: string | null = folderId ?? null;

    if (!targetFolderId && creds.rootFolderId) {
      if (clientCode) {
        // root / {ClientCode} / Meeting Notes / {date}
        const segments = [clientCode, 'Meeting Notes'];
        if (pdfData.meetingDate) segments.push(pdfData.meetingDate);
        targetFolderId = await ensureFolderPath(creds.drive, creds.rootFolderId, segments);
      } else {
        // root / Meeting Notes
        targetFolderId = await ensureFolderPath(creds.drive, creds.rootFolderId, ['Meeting Notes']);
      }
    }

    // ── Generate PDF ──────────────────────────────────────────────────────────
    const pdfBytes = await generateMeetingPDF(pdfData);
    const safeName = pdfData.title.replace(/[^a-zA-Z0-9 ._-]/g, '_');
    const filename = `Meeting Notes - ${safeName} - ${pdfData.meetingDate}.pdf`;

    // ── Upload to Drive ───────────────────────────────────────────────────────
    const nodeStream = Readable.from(Buffer.from(pdfBytes));

    const driveRes = await creds.drive.files.create({
      requestBody: {
        name: filename,
        ...(targetFolderId ? { parents: [targetFolderId] } : {}),
      },
      media: {
        mimeType: 'application/pdf',
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
    console.error('[save-pdf-to-drive]', err);
    return NextResponse.json(
      { error: 'Failed to save PDF to Drive. Please try again.' },
      { status: 500 },
    );
  }
}
