import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createServiceClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';
import { getRefreshedDriveCredentials } from '@/lib/vaultHelpers';
import { uploadFileWithDrive } from '@/lib/googleDrive';
import type { drive_v3 } from 'googleapis';

// Google Drive path for email attachments larger than Gmail's 25 MB ceiling (or
// that would take the message over it).
//   POST   → stage-bucket file → firm Drive → shareable link
//   DELETE → remove a previously-uploaded file (when the user removes the chip)
//   PATCH  → move a file to a different folder (the link is unchanged)
// Delete/move are guarded: a file can only be touched by the user who uploaded
// it, verified via the private appProperties tags set at upload time.

export const maxDuration = 120;

const BUCKET = 'email-attachments-staging';
const TAG_KEY = 'smithEmailAttachment';

async function requireDrive(firmId: string) {
  const creds = await getRefreshedDriveCredentials(firmId);
  if (!creds) return null;
  return creds;
}

/** Confirm the Drive file was uploaded by this user through the email flow. */
async function assertOwnedByUser(drive: drive_v3.Drive, fileId: string, userId: string): Promise<{ ok: boolean; parents: string[] }> {
  const meta = await drive.files.get({ fileId, fields: 'appProperties,parents', supportsAllDrives: true });
  const ap = meta.data.appProperties ?? {};
  const ok = ap[TAG_KEY] === 'true' && ap.uploadedBy === userId;
  return { ok, parents: meta.data.parents ?? [] };
}

// ── POST — upload to Drive ───────────────────────────────────────────────────
const PostSchema = z.object({
  stagePath: z.string().min(1),
  filename:  z.string().min(1).max(300),
  mimeType:  z.string().min(1).max(200),
  folderId:  z.string().nullable().optional(),
});

export async function POST(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  if (!ctx.activeModules.includes('email-triage')) {
    return NextResponse.json({ error: 'Module not active' }, { status: 403 });
  }

  const parsed = PostSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' }, { status: 400 });
  const { stagePath, filename, mimeType, folderId } = parsed.data;

  // The staged file must live in this user's own folder.
  if (!stagePath.startsWith(`${ctx.userId}/`)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const creds = await requireDrive(ctx.firmId);
  if (!creds) {
    return NextResponse.json(
      { error: 'Google Drive is not connected for your firm. Ask a firm admin to connect it in Settings → Document Vault.' },
      { status: 400 },
    );
  }

  const service = createServiceClient();
  const { data: blob, error: dlErr } = await service.storage.from(BUCKET).download(stagePath);
  if (dlErr || !blob) {
    console.error('[email/drive-upload] staging download', dlErr);
    return NextResponse.json({ error: 'Could not read the uploaded file. Please try attaching it again.' }, { status: 400 });
  }
  const buffer = Buffer.from(await blob.arrayBuffer());

  try {
    const { drive, rootFolderId } = creds;
    const targetFolder = folderId || rootFolderId || '';

    const file = await uploadFileWithDrive(drive, {
      folderId: targetFolder,
      fileName: filename,
      mimeType,
      buffer,
      appProperties: { [TAG_KEY]: 'true', uploadedBy: ctx.userId },
    });
    if (!file.id) throw new Error('Drive upload returned no file id');

    // Make it viewable to anyone with the link. If the firm's Google Workspace
    // has link sharing disabled this throws — delete the un-openable file and
    // return a friendly, actionable message rather than a raw Google error.
    try {
      await drive.permissions.create({
        fileId: file.id,
        requestBody: { role: 'reader', type: 'anyone' },
        supportsAllDrives: true,
      });
    } catch (permErr) {
      console.error('[email/drive-upload] share', permErr);
      await drive.files.delete({ fileId: file.id, supportsAllDrives: true }).catch(() => { /* best-effort */ });
      return NextResponse.json({
        error: 'Your organisation’s Google Workspace has link sharing switched off, so this file can’t be shared by link. Ask your Google Workspace admin to allow “Anyone with the link” sharing, or send a file under 25 MB.',
        code: 'drive_sharing_disabled',
      }, { status: 400 });
    }

    let link = file.webViewLink ?? '';
    if (!link) {
      const got = await drive.files.get({ fileId: file.id, fields: 'webViewLink', supportsAllDrives: true });
      link = got.data.webViewLink ?? '';
    }

    return NextResponse.json({ name: file.name ?? filename, link, fileId: file.id });
  } catch (err) {
    console.error('[email/drive-upload] drive', err);
    return NextResponse.json({ error: err instanceof Error ? err.message.slice(0, 300) : 'Failed to upload to Google Drive' }, { status: 502 });
  } finally {
    await service.storage.from(BUCKET).remove([stagePath]).catch(() => { /* best-effort */ });
  }
}

// ── DELETE — remove the file from Drive (chip removed before sending) ─────────
const IdSchema = z.object({ fileId: z.string().min(1) });

export async function DELETE(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  if (!ctx.activeModules.includes('email-triage')) return NextResponse.json({ error: 'Module not active' }, { status: 403 });

  const parsed = IdSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Invalid input' }, { status: 400 });

  const creds = await requireDrive(ctx.firmId);
  if (!creds) return NextResponse.json({ error: 'Google Drive is not connected.' }, { status: 400 });

  try {
    const { drive } = creds;
    const { ok } = await assertOwnedByUser(drive, parsed.data.fileId, ctx.userId);
    if (!ok) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    await drive.files.delete({ fileId: parsed.data.fileId, supportsAllDrives: true });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[email/drive-upload] delete', err);
    return NextResponse.json({ error: 'Failed to remove the file from Google Drive.' }, { status: 502 });
  }
}

// ── PATCH — move the file to another folder (link is unchanged) ───────────────
const MoveSchema = z.object({ fileId: z.string().min(1), folderId: z.string().min(1) });

export async function PATCH(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  if (!ctx.activeModules.includes('email-triage')) return NextResponse.json({ error: 'Module not active' }, { status: 403 });

  const parsed = MoveSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Invalid input' }, { status: 400 });
  const { fileId, folderId } = parsed.data;

  const creds = await requireDrive(ctx.firmId);
  if (!creds) return NextResponse.json({ error: 'Google Drive is not connected.' }, { status: 400 });

  try {
    const { drive } = creds;
    const { ok, parents } = await assertOwnedByUser(drive, fileId, ctx.userId);
    if (!ok) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    await drive.files.update({
      fileId,
      addParents: folderId,
      removeParents: parents.length ? parents.join(',') : undefined,
      supportsAllDrives: true,
      fields: 'id',
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[email/drive-upload] move', err);
    return NextResponse.json({ error: 'Failed to move the file in Google Drive.' }, { status: 502 });
  }
}
