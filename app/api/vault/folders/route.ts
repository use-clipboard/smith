import { NextRequest, NextResponse } from 'next/server';
import { getUserContext } from '@/lib/getUserContext';
import { getRefreshedDriveCredentials } from '@/lib/vaultHelpers';

/** GET /api/vault/folders?parent_id=xxx  — list subfolders */
export async function GET(req: NextRequest) {
  try {
    const userCtx = await getUserContext();
    if (!userCtx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

    const creds = await getRefreshedDriveCredentials(userCtx.firmId);
    if (!creds) return NextResponse.json({ error: 'Google Drive not connected' }, { status: 400 });

    const { drive, rootFolderId } = creds;
    const parentId = req.nextUrl.searchParams.get('parent_id') || rootFolderId;
    if (!parentId) return NextResponse.json({ error: 'No root folder configured' }, { status: 400 });

    // List subfolders of the requested parent
    const res = await drive.files.list({
      q: `'${parentId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
      fields: 'files(id, name)',
      orderBy: 'name',
      pageSize: 200,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });

    // Also fetch the parent folder's own name so the UI can build breadcrumbs
    let parentName = 'Drive';
    try {
      const meta = await drive.files.get({ fileId: parentId, fields: 'name', supportsAllDrives: true });
      parentName = meta.data.name ?? 'Drive';
    } catch { /* ignore */ }

    return NextResponse.json({
      parentId,
      parentName,
      rootFolderId,
      folders: (res.data.files ?? []).map(f => ({ id: f.id!, name: f.name! })),
    });
  } catch (err) {
    console.error('[/api/vault/folders GET]', err);
    return NextResponse.json({ error: 'Failed to list folders' }, { status: 500 });
  }
}

/** POST /api/vault/folders — create a new subfolder */
export async function POST(req: NextRequest) {
  try {
    const userCtx = await getUserContext();
    if (!userCtx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

    const { name, parent_id } = await req.json();
    if (!name?.trim()) return NextResponse.json({ error: 'Folder name required' }, { status: 400 });

    const creds = await getRefreshedDriveCredentials(userCtx.firmId);
    if (!creds) return NextResponse.json({ error: 'Google Drive not connected' }, { status: 400 });

    const { drive, rootFolderId } = creds;
    const parentId = parent_id || rootFolderId;
    if (!parentId) return NextResponse.json({ error: 'No root folder configured' }, { status: 400 });

    const res = await drive.files.create({
      requestBody: {
        name: name.trim(),
        mimeType: 'application/vnd.google-apps.folder',
        parents: [parentId],
      },
      fields: 'id, name',
      supportsAllDrives: true,
    });

    return NextResponse.json({ id: res.data.id!, name: res.data.name! });
  } catch (err) {
    console.error('[/api/vault/folders POST]', err);
    return NextResponse.json({ error: 'Failed to create folder' }, { status: 500 });
  }
}
