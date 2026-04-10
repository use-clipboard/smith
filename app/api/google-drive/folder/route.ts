import { NextRequest, NextResponse } from 'next/server';
import { getUserContext } from '@/lib/getUserContext';
import { createServiceClient } from '@/lib/supabase-server';

export async function POST(req: NextRequest) {
  try {
    const userCtx = await getUserContext();
    if (!userCtx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

    const body = await req.json();
    const { folderId, folderName } = body as { folderId: string; folderName?: string };

    if (!folderId) {
      return NextResponse.json({ error: 'Missing folderId' }, { status: 400 });
    }

    const db = createServiceClient();
    const { error } = await db
      .from('firm_settings')
      .update({
        google_drive_folder_id: folderId,
        google_drive_folder_name: folderName ?? null,
        updated_at: new Date().toISOString(),
      })
      .eq('firm_id', userCtx.firmId);

    if (error) {
      console.error('[google-drive/folder]', error);
      return NextResponse.json({ error: 'Failed to save folder' }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[google-drive/folder]', err);
    return NextResponse.json({ error: 'Failed to save folder' }, { status: 500 });
  }
}
