import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getUserContext } from '@/lib/getUserContext';
import { uploadDocumentsToDrive } from '@/lib/driveUpload';
import { createServiceClient } from '@/lib/supabase-server';

// Large scanned PDFs blow past the ~4.5 MB serverless body cap when sent inline
// as base64, so the browser stages those directly in the document-uploads-staging
// bucket and sends just the object path. Small files still come inline. Give the
// function room to download staged files and push them to Drive.
export const maxDuration = 120;

const STAGING_BUCKET = 'document-uploads-staging';

// A file is either inline (base64) or staged in the bucket (stagePath). Exactly
// one of the two is present.
const FileSchema = z.object({
  name: z.string(),
  mimeType: z.string(),
  base64: z.string().optional(),
  stagePath: z.string().optional(),
}).refine(f => !!f.base64 || !!f.stagePath, { message: 'Each file needs base64 or stagePath' });

const RequestSchema = z.object({
  files: z.array(FileSchema),
  clientId: z.string().nullable().optional(),
  clientCode: z.string().min(1),
  feature: z.string(),
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = RequestSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 });
    }

    const userCtx = await getUserContext();
    if (!userCtx) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const { files, clientId, clientCode, feature } = parsed.data;

    // Resolve staged files: download each from the bucket (service-role, bypasses
    // RLS) and turn it into the { name, mimeType, base64 } shape the Drive helper
    // expects. Inline files pass straight through.
    const service = createServiceClient();
    const stagedPaths: string[] = [];
    const resolvedFiles = await Promise.all(files.map(async (f) => {
      if (f.base64) return { name: f.name, mimeType: f.mimeType, base64: f.base64 };
      const stagePath = f.stagePath!;
      // A staged file must live in this user's own folder.
      if (!stagePath.startsWith(`${userCtx.userId}/`)) {
        throw new Error('Forbidden staged file path');
      }
      const { data: blob, error } = await service.storage.from(STAGING_BUCKET).download(stagePath);
      if (error || !blob) throw new Error('Could not read an uploaded file. Please try saving again.');
      stagedPaths.push(stagePath);
      const base64 = Buffer.from(await blob.arrayBuffer()).toString('base64');
      return { name: f.name, mimeType: f.mimeType, base64 };
    }));

    try {
      const uploadedFiles = await uploadDocumentsToDrive({
        files: resolvedFiles,
        clientId: clientId ?? null,
        clientCode,
        ...userCtx,
        feature,
      });
      return NextResponse.json({ success: true, count: resolvedFiles.length, uploadedFiles });
    } finally {
      // Best-effort cleanup of the transient staged copies.
      if (stagedPaths.length) {
        await service.storage.from(STAGING_BUCKET).remove(stagedPaths).catch(() => { /* swept by cron otherwise */ });
      }
    }
  } catch (err) {
    console.error('[/api/documents/upload]', err);
    const message = err instanceof Error ? err.message : 'Upload failed. Please try again.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
