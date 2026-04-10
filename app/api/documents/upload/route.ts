import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getUserContext } from '@/lib/getUserContext';
import { uploadDocumentsToDrive } from '@/lib/driveUpload';

const RequestSchema = z.object({
  files: z.array(z.object({
    name: z.string(),
    mimeType: z.string(),
    base64: z.string(),
  })),
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

    const uploadedFiles = await uploadDocumentsToDrive({
      files,
      clientId: clientId ?? null,
      clientCode,
      ...userCtx,
      feature,
    });

    return NextResponse.json({ success: true, count: files.length, uploadedFiles });
  } catch (err) {
    console.error('[/api/documents/upload]', err);
    return NextResponse.json({ error: 'Upload failed. Please try again.' }, { status: 500 });
  }
}
