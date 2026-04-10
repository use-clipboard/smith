import { createServiceClient } from '@/lib/supabase-server';
import { uploadFileWithDrive, createFolderWithDrive, getRefreshedDriveClient } from '@/lib/googleDrive';

interface FilePayload {
  name: string;
  mimeType: string;
  base64: string;
}

interface UploadOptions {
  files: FilePayload[];
  clientId?: string | null;
  clientCode?: string | null;
  userId: string;
  firmId: string;
  feature: string;
}

/**
 * Uploads files to the firm's connected Google Drive and records them in the documents table.
 * Silently skips if Drive is not connected. Errors per-file are caught and logged individually
 * so a single bad file doesn't abort the whole batch.
 */
export async function uploadDocumentsToDrive({
  files,
  clientId,
  clientCode,
  userId,
  firmId,
  feature,
}: UploadOptions): Promise<{ name: string; driveUrl: string; driveFileId: string }[]> {
  if (!files.length) return [];
  const uploadedFiles: { name: string; driveUrl: string; driveFileId: string }[] = [];

  const db = createServiceClient();

  const { data: settings } = await db
    .from('firm_settings')
    .select('google_drive_enabled, google_drive_folder_id, google_refresh_token')
    .eq('firm_id', firmId)
    .single();

  if (
    !settings?.google_drive_enabled ||
    !settings.google_refresh_token ||
    !settings.google_drive_folder_id
  ) {
    return []; // Drive not configured — skip silently
  }

  const refreshToken = settings.google_refresh_token as string;
  let rootFolderId = settings.google_drive_folder_id as string;

  // Always refresh the token — stored access tokens expire after 1 hour
  const { drive, accessToken } = await getRefreshedDriveClient(refreshToken);
  await db.from('firm_settings').update({ google_access_token: accessToken }).eq('firm_id', firmId);

  // Verify the stored root folder still exists and isn't trashed
  try {
    const rootCheck = await drive.files.get({
      fileId: rootFolderId,
      fields: 'id,trashed',
      supportsAllDrives: true,
    });
    if (rootCheck.data.trashed) throw new Error('trashed');
  } catch {
    // Folder is missing or trashed — log and bail out rather than silently redirecting
    // to a different folder (which could be the wrong My Drive root for shared drive setups)
    console.error('[driveUpload] Configured root folder is inaccessible. Re-select a folder in Settings.');
    return [];
  }

  let targetFolderId = rootFolderId;

  // Place files in a per-client-code subfolder when a client code is known
  if (clientCode) {
    try {
      // Check if a folder for this client code already exists in Drive
      const searchRes = await drive.files.list({
        q: `name = '${clientCode}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false and '${rootFolderId}' in parents`,
        fields: 'files(id)',
        pageSize: 1,
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
      });
      if (searchRes.data.files?.length) {
        targetFolderId = searchRes.data.files[0].id!;
      } else {
        const folder = await createFolderWithDrive(drive, { name: clientCode, parentFolderId: rootFolderId });
        targetFolderId = folder.id!;
      }
    } catch (err) {
      console.error('[driveUpload] Failed to resolve client folder, falling back to root folder:', err);
      targetFolderId = rootFolderId;
    }
  }

  for (const file of files) {
    try {
      const buffer = Buffer.from(file.base64, 'base64');
      const driveFile = await uploadFileWithDrive(drive, {
        folderId: targetFolderId,
        fileName: file.name,
        mimeType: file.mimeType,
        buffer,
      });

      await db.from('documents').insert({
        client_id: clientId || null,
        uploaded_by: userId,
        file_name: file.name,
        file_url: driveFile.webViewLink,
        drive_file_id: driveFile.id,
        drive_folder_id: targetFolderId,
        document_type: feature,
      });

      // Use webViewLink if available, otherwise construct directly from file ID
      const driveUrl = driveFile.webViewLink ?? (driveFile.id ? `https://drive.google.com/file/d/${driveFile.id}/view` : null);
      if (driveUrl && driveFile.id) {
        uploadedFiles.push({ name: file.name, driveUrl, driveFileId: driveFile.id });
      }
    } catch (err) {
      console.error(`[driveUpload] Failed to upload "${file.name}":`, err);
    }
  }

  return uploadedFiles;
}

/**
 * Saves a completed AI output to the outputs table, linked to a client.
 * Silently skips if clientId is null. Errors are swallowed so they don't
 * affect the user-facing response.
 */
export async function saveOutput({
  clientId,
  userId,
  feature,
  targetSoftware,
}: {
  clientId: string | null;
  userId: string;
  feature: string;
  targetSoftware?: string | null;
}): Promise<void> {
  try {
    const db = createServiceClient();
    await db.from('outputs').insert({
      client_id: clientId,
      user_id: userId,
      feature,
      target_software: targetSoftware ?? null,
    });
  } catch (err) {
    console.error('[saveOutput] Failed:', err);
  }
}

/**
 * Creates vault_documents rows for a set of files that were processed by an Agent Smith tool,
 * then fires off tagging for each.  Fully fire-and-forget — never throws or blocks the caller.
 */
export async function saveDocumentsToVault({
  files,
  clientId,
  userId,
  firmId,
  sourceTool,
  siteUrl,
  cookieHeader,
}: {
  files: Array<{ name: string; mimeType: string; base64: string }>;
  clientId?: string | null;
  userId: string;
  firmId: string;
  sourceTool: string;
  siteUrl: string;
  cookieHeader: string;
}): Promise<void> {
  if (!files.length || !siteUrl) return;

  const db = createServiceClient();

  for (const file of files) {
    try {
      // Build a synthetic Drive file ID from name+size hash so we can dedup
      // In practice, files uploaded via tools are also uploaded to Drive via uploadDocumentsToDrive,
      // so a Drive file ID should already exist.  We insert with a placeholder and the real ID
      // will be overwritten when Drive upload completes.
      const pseudoId = `tool:${sourceTool}:${firmId}:${file.name}:${file.base64.length}`;

      // Check if already vaulted
      const { data: existing } = await db
        .from('vault_documents')
        .select('id')
        .eq('google_drive_file_id', pseudoId)
        .maybeSingle();

      if (existing) continue;

      const buffer = Buffer.from(file.base64, 'base64');

      const { data: doc } = await db
        .from('vault_documents')
        .insert({
          firm_id: firmId,
          user_id: userId,
          client_id: clientId ?? null,
          google_drive_file_id: pseudoId,
          file_name: file.name,
          file_mime_type: file.mimeType,
          file_size_bytes: buffer.byteLength,
          tagging_status: 'untagged',
          source: 'agent_smith_tool',
          source_tool: sourceTool,
        })
        .select('id')
        .single();

      if (doc?.id) {
        // Fire-and-forget tagging
        fetch(`${siteUrl}/api/vault/tag/single`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Cookie: cookieHeader },
          body: JSON.stringify({ vault_document_id: doc.id }),
        }).catch(() => {});
      }
    } catch {
      // Silently ignore per-file failures
    }
  }
}

/**
 * Logs an AI API call to the ai_logs table. Never throws — logging failures
 * are swallowed so they don't affect the user-facing response.
 */
export async function logAiUsage({
  userId,
  clientId,
  feature,
  inputTokens,
  outputTokens,
}: {
  userId: string;
  clientId?: string | null;
  feature: string;
  inputTokens: number;
  outputTokens: number;
}): Promise<void> {
  try {
    const db = createServiceClient();
    await db.from('ai_logs').insert({
      user_id: userId,
      client_id: clientId || null,
      feature,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
    });
  } catch (err) {
    console.error('[logAiUsage] Failed:', err);
  }
}
