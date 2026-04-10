import { NextRequest, NextResponse } from 'next/server';
import { getUserContext } from '@/lib/getUserContext';
import { getRefreshedDriveCredentials } from '@/lib/vaultHelpers';

export async function GET(req: NextRequest) {
  try {
    const userCtx = await getUserContext();
    if (!userCtx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

    const creds = await getRefreshedDriveCredentials(userCtx.firmId);
    if (!creds) return NextResponse.json({ error: 'Drive not connected' }, { status: 400 });

    const { drive } = creds;
    const { searchParams } = new URL(req.url);
    const parentId = searchParams.get('parentId');
    const isSharedDrive = searchParams.get('isSharedDrive') === 'true';
    const driveId = searchParams.get('driveId');

    // No parentId → return top-level: My Drive + Shared Drives
    if (!parentId) {
      const items: { id: string; name: string; type: string }[] = [
        { id: 'root', name: 'My Drive', type: 'root' },
      ];

      try {
        const drivesRes = await drive.drives.list({
          fields: 'drives(id,name)',
          pageSize: 50,
        });
        for (const d of drivesRes.data.drives ?? []) {
          items.push({ id: d.id!, name: d.name!, type: 'shared_drive' });
        }
      } catch {
        // User may not have access to any shared drives — that's fine
      }

      return NextResponse.json({ items });
    }

    // parentId provided → list subfolders
    let items: { id: string; name: string; type: string }[] = [];

    if (isSharedDrive) {
      // Top-level folders inside a Shared Drive
      const res = await drive.files.list({
        corpora: 'drive',
        driveId: parentId,
        includeItemsFromAllDrives: true,
        supportsAllDrives: true,
        q: `mimeType = 'application/vnd.google-apps.folder' and '${parentId}' in parents and trashed = false`,
        fields: 'files(id,name)',
        pageSize: 100,
        orderBy: 'name',
      });
      items = (res.data.files ?? []).map(f => ({ id: f.id!, name: f.name!, type: 'folder' }));
    } else {
      // Subfolders of a regular folder (works for My Drive root via parentId='root')
      const res = await drive.files.list({
        q: `mimeType = 'application/vnd.google-apps.folder' and '${parentId}' in parents and trashed = false`,
        includeItemsFromAllDrives: true,
        supportsAllDrives: true,
        fields: 'files(id,name)',
        pageSize: 100,
        orderBy: 'name',
        ...(driveId ? { corpora: 'drive' as const, driveId } : {}),
      });
      items = (res.data.files ?? []).map(f => ({ id: f.id!, name: f.name!, type: 'folder' }));
    }

    return NextResponse.json({ items });
  } catch (err) {
    console.error('[google-drive/browse]', err);
    return NextResponse.json({ error: 'Failed to browse Drive' }, { status: 500 });
  }
}
