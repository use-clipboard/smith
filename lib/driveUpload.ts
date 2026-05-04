import { createServiceClient } from '@/lib/supabase-server';
import { uploadFileWithDrive, createFolderWithDrive, getRefreshedDriveClient } from '@/lib/googleDrive';
import { google } from 'googleapis';

type DriveClient = ReturnType<typeof google.drive>;

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

// Map internal feature slugs to human-readable folder names
const FEATURE_FOLDER_NAMES: Record<string, string> = {
  'full_analysis':         'Full Analysis',
  'bank_to_csv':           'Bank to CSV',
  'bank-to-csv':           'Bank to CSV',
  'landlord':              'Landlord Analysis',
  'landlord_analysis':     'Landlord Analysis',
  'final_accounts':        'Final Accounts',
  'final_accounts_review': 'Final Accounts',
  'performance':           'Performance Analysis',
  'performance_analysis':  'Performance Analysis',
  'p32':                   'P32 Summary',
  'p32_summary':           'P32 Summary',
  'risk_assessment':       'Risk Assessment',
  'summarise':             'Summarise',
};

function featureFolderName(feature: string): string {
  return FEATURE_FOLDER_NAMES[feature]
    ?? feature.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function todayFolderName(): string {
  const d = new Date();
  const day  = String(d.getDate()).padStart(2, '0');
  const mon  = d.toLocaleString('en-GB', { month: 'short' }); // "Apr"
  const year = d.getFullYear();
  return `${day} ${mon} ${year}`; // "30 Apr 2026"
}

/**
 * Find an existing Drive folder by name inside a parent, or create it.
 * Returns the folder ID.
 */
async function getOrCreateFolder(
  drive: DriveClient,
  name: string,
  parentId: string
): Promise<string> {
  // Escape single quotes in folder name for Drive query
  const safeName = name.replace(/'/g, "\\'");
  const search = await drive.files.list({
    q: `name = '${safeName}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false and '${parentId}' in parents`,
    fields: 'files(id)',
    pageSize: 1,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });
  if (search.data.files?.length) {
    return search.data.files[0].id!;
  }
  const folder = await createFolderWithDrive(drive, { name, parentFolderId: parentId });
  return folder.id!;
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

  // Build folder hierarchy: root / ClientCode / ToolName / DD MMM YYYY
  try {
    // Level 1 — client code folder (skip if no client code)
    let level1Id = rootFolderId;
    if (clientCode) {
      level1Id = await getOrCreateFolder(drive, clientCode, rootFolderId);
    }

    // Level 2 — tool name folder
    const toolFolderName = featureFolderName(feature);
    const level2Id = await getOrCreateFolder(drive, toolFolderName, level1Id);

    // Level 3 — date folder (today, so all uploads on the same day share one folder)
    const dateFolderName = todayFolderName();
    targetFolderId = await getOrCreateFolder(drive, dateFolderName, level2Id);
  } catch (err) {
    console.error('[driveUpload] Failed to resolve folder hierarchy, falling back to root folder:', err);
    targetFolderId = rootFolderId;
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
  if (!files.length) return; // siteUrl no longer required for the insert

  const db = createServiceClient();
  const now = new Date().toISOString();

  for (const file of files) {
    try {
      const buffer = Buffer.from(file.base64, 'base64');

      // Stable dedup key scoped to firm + tool + file name + size
      const pseudoId = `tool:${sourceTool}:${firmId}:${file.name}:${buffer.byteLength}`;

      // Skip if this exact file was already vaulted for this firm+tool
      const { data: existing } = await db
        .from('vault_documents')
        .select('id')
        .eq('google_drive_file_id', pseudoId)
        .maybeSingle();

      if (existing) continue;

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
          // Set drive_modified_at so tool uploads sort near the top (not buried at bottom)
          drive_modified_at: now,
          tagging_status: 'untagged',
          source: 'agent_smith_tool',
          source_tool: sourceTool,
        })
        .select('id')
        .single();

      // Note: we do NOT auto-tag tool uploads here. The google_drive_file_id is a
      // pseudo-ID (not a real Drive file), so the tag/single route would fail trying
      // to fetch it from Drive. Documents appear as 'untagged' — users can tag them
      // manually from the vault, or they get picked up by Drive sync once uploaded.
    } catch (err) {
      console.error(`[saveDocumentsToVault] Failed to vault "${file.name}":`, err);
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
