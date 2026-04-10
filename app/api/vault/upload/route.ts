import { NextRequest, NextResponse } from 'next/server';
import { getUserContext } from '@/lib/getUserContext';
import { getDriveCredentials } from '@/lib/vaultHelpers';
import { createFolder, uploadFileToDrive } from '@/lib/googleDrive';
import { getDriveClient } from '@/lib/googleDrive';
import { createServiceClient } from '@/lib/supabase-server';
import { Readable } from 'stream';

const VAULT_FOLDER_NAME = 'Agent Smith Vault';

async function getOrCreateVaultFolder(
  accessToken: string,
  refreshToken: string
): Promise<string> {
  const drive = await getDriveClient(accessToken, refreshToken);

  // Search for existing vault folder at Drive root
  const searchRes = await drive.files.list({
    q: `name = '${VAULT_FOLDER_NAME}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false and 'root' in parents`,
    fields: 'files(id,name)',
    pageSize: 1,
  });

  if (searchRes.data.files && searchRes.data.files.length > 0) {
    return searchRes.data.files[0].id!;
  }

  // Create it
  const folder = await createFolder({
    accessToken,
    refreshToken,
    name: VAULT_FOLDER_NAME,
  });
  return folder.id!;
}

export async function POST(req: NextRequest) {
  try {
    const userCtx = await getUserContext();
    if (!userCtx) {
      return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
    }

    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    const clientId = (formData.get('client_id') as string | null) || null;

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    const creds = await getDriveCredentials(userCtx.firmId);
    if (!creds) {
      return NextResponse.json({ error: 'Google Drive not connected' }, { status: 400 });
    }

    // Get or create vault folder
    const vaultFolderId = await getOrCreateVaultFolder(creds.accessToken, creds.refreshToken);

    // Upload file to Drive
    const buffer = Buffer.from(await file.arrayBuffer());
    const drive = await getDriveClient(creds.accessToken, creds.refreshToken);

    const driveRes = await drive.files.create({
      requestBody: {
        name: file.name,
        parents: [vaultFolderId],
      },
      media: {
        mimeType: file.type,
        body: Readable.from(buffer),
      },
      fields: 'id,webViewLink,name,mimeType,size,createdTime,modifiedTime',
    });

    void uploadFileToDrive; // imported only to keep the import consistent — actual upload done above

    const driveFile = driveRes.data;

    // Insert vault_documents row
    const db = createServiceClient();
    const { data: doc, error } = await db
      .from('vault_documents')
      .insert({
        firm_id: userCtx.firmId,
        user_id: userCtx.userId,
        client_id: clientId,
        google_drive_file_id: driveFile.id!,
        google_drive_url: driveFile.webViewLink ?? null,
        file_name: file.name,
        file_mime_type: file.type,
        file_size_bytes: buffer.byteLength,
        google_drive_folder_path: VAULT_FOLDER_NAME,
        tagging_status: 'untagged',
        source: 'agent_smith_tool',
        source_tool: 'vault_upload',
        drive_created_at: driveFile.createdTime ?? null,
        drive_modified_at: driveFile.modifiedTime ?? null,
      })
      .select()
      .single();

    if (error || !doc) {
      console.error('[/api/vault/upload] DB insert failed:', error);
      return NextResponse.json({ error: 'Failed to record upload.' }, { status: 500 });
    }

    // Fire-and-forget: trigger tagging for this document
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? '';
    if (siteUrl) {
      fetch(`${siteUrl}/api/vault/tag/single`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: req.headers.get('cookie') ?? '' },
        body: JSON.stringify({ vault_document_id: doc.id }),
      }).catch(err => console.error('[vault/upload] Background tagging failed:', err));
    }

    return NextResponse.json(doc);
  } catch (err) {
    console.error('[/api/vault/upload]', err);
    return NextResponse.json({ error: 'Upload failed. Please try again.' }, { status: 500 });
  }
}
