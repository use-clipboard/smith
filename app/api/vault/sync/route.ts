import { NextRequest, NextResponse } from 'next/server';
import type { drive_v3 } from 'googleapis';
import { getUserContext } from '@/lib/getUserContext';
import { buildModuleChecker, moduleNotActive } from '@/lib/modules';
import { getRefreshedDriveCredentials } from '@/lib/vaultHelpers';
import { createServiceClient } from '@/lib/supabase-server';

// Maximum number of folders to collect via BFS before stopping (prevents timeouts)
const MAX_FOLDERS = 500;
// How many folder IDs to include per Drive files.list query (URL length limit)
const FOLDER_BATCH_SIZE = 30;
// Max files to process in a single sync run
const MAX_FILES = 1000;

interface FolderNode {
  id: string;
  name: string;
  parentId: string | null;
}

/**
 * Collect all subfolder IDs under a root folder using BFS.
 * Returns a map of folderId -> FolderNode so we can reconstruct paths without
 * extra API calls per file.
 */
async function collectAllFolders(
  drive: ReturnType<typeof import('googleapis').google.drive>,
  rootFolderId: string,
  rootFolderName: string
): Promise<Map<string, FolderNode>> {
  const folderMap = new Map<string, FolderNode>();
  folderMap.set(rootFolderId, { id: rootFolderId, name: rootFolderName, parentId: null });
  const queue: string[] = [rootFolderId];

  while (queue.length > 0 && folderMap.size < MAX_FOLDERS) {
    const parentId = queue.shift()!;

    let pageToken: string | undefined;
    do {
      const res: { data: drive_v3.Schema$FileList } = await drive.files.list({
        q: `'${parentId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
        fields: 'nextPageToken, files(id, name)',
        pageSize: 100,
        pageToken,
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
      });

      for (const folder of res.data.files ?? []) {
        if (folder.id && folder.name && folderMap.size < MAX_FOLDERS) {
          folderMap.set(folder.id, { id: folder.id, name: folder.name, parentId: parentId });
          queue.push(folder.id);
        }
      }

      pageToken = res.data.nextPageToken ?? undefined;
    } while (pageToken && folderMap.size < MAX_FOLDERS);
  }

  if (folderMap.size >= MAX_FOLDERS) {
    console.warn(`[vault/sync] Folder cap (${MAX_FOLDERS}) reached — some subfolders may not be indexed`);
  }

  return folderMap;
}

/**
 * Build a human-readable folder path for a given folder ID using the pre-built map.
 * e.g. "Agent Smith Files / T103 / Full Analysis / 30 Apr 2026"
 */
function buildFolderPath(folderId: string, folderMap: Map<string, FolderNode>): string {
  const parts: string[] = [];
  let current = folderMap.get(folderId);
  while (current) {
    parts.unshift(current.name);
    current = current.parentId ? folderMap.get(current.parentId) : undefined;
  }
  return parts.join(' / ');
}

export async function POST(_req: NextRequest) {
  try {
    const userCtx = await getUserContext();
    if (!userCtx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
    const { isModuleActive } = buildModuleChecker(userCtx.activeModules);
    if (!isModuleActive('document-vault')) return moduleNotActive('document-vault');

    const creds = await getRefreshedDriveCredentials(userCtx.firmId);
    if (!creds) {
      return NextResponse.json({ error: 'Google Drive not connected' }, { status: 400 });
    }

    const db = createServiceClient();
    const { drive, rootFolderId } = creds;

    let newCount = 0;
    let updatedCount = 0;
    let deletedCount = 0;
    let totalProcessed = 0;
    const seenFileIds = new Set<string>();

    // Collect all folders via BFS — builds a map of id→{name,parentId} so we
    // can reconstruct folder paths without any extra Drive API calls per file.
    let folderMap = new Map<string, FolderNode>();
    if (rootFolderId) {
      console.log(`[vault/sync] Collecting subfolders under root: ${rootFolderId}`);
      // Fetch the root folder name so paths start with the correct label
      let rootFolderName = 'Drive';
      try {
        const rootMeta = await drive.files.get({ fileId: rootFolderId, fields: 'name', supportsAllDrives: true });
        rootFolderName = rootMeta.data.name ?? 'Drive';
      } catch { /* fall back to generic label */ }
      folderMap = await collectAllFolders(drive, rootFolderId, rootFolderName);
      console.log(`[vault/sync] Found ${folderMap.size} folders total`);
    }

    const folderIds = [...folderMap.keys()];

    // If no root folder configured, fall through with empty folder list (will find 0 files)
    if (folderIds.length === 0) {
      console.warn('[vault/sync] No folders to search — Drive root folder not configured');
    }

    // Split folder IDs into batches to avoid query string length limits
    const folderBatches: string[][] = [];
    for (let i = 0; i < folderIds.length; i += FOLDER_BATCH_SIZE) {
      folderBatches.push(folderIds.slice(i, i + FOLDER_BATCH_SIZE));
    }

    // Query files across all folder batches
    for (const batch of folderBatches) {
      if (totalProcessed >= MAX_FILES) break;

      // Build OR clause: ('id1' in parents or 'id2' in parents or ...)
      const parentClause = batch.map(id => `'${id}' in parents`).join(' or ');
      const query = `trashed = false and mimeType != 'application/vnd.google-apps.folder' and (${parentClause})`;

      let pageParam: string | undefined;
      do {
        if (totalProcessed >= MAX_FILES) break;

        const listRes: { data: drive_v3.Schema$FileList } = await drive.files.list({
          q: query,
          fields: 'nextPageToken, files(id, name, mimeType, size, webViewLink, createdTime, modifiedTime, parents)',
          pageSize: 100,
          pageToken: pageParam,
          supportsAllDrives: true,
          includeItemsFromAllDrives: true,
        });

        const files = listRes.data.files ?? [];
        pageParam = listRes.data.nextPageToken ?? undefined;

        if (files.length === 0) continue;

        // Look up which of these files are already in the vault
        const { data: existingDocs } = await db
          .from('vault_documents')
          .select('google_drive_file_id, drive_modified_at, google_drive_folder_path')
          .eq('firm_id', userCtx.firmId)
          .in('google_drive_file_id', files.map((f: drive_v3.Schema$File) => f.id!).filter(Boolean));

        const existingMap = new Map(
          (existingDocs ?? []).map(d => [d.google_drive_file_id, {
            modifiedAt: d.drive_modified_at as string | null,
            hasPath: !!d.google_drive_folder_path,
          }])
        );

        for (const file of files) {
          if (!file.id || !file.name) continue;
          if (totalProcessed >= MAX_FILES) break;

          totalProcessed++;
          seenFileIds.add(file.id);
          const existing = existingMap.get(file.id);
          const existingModifiedAt = existing?.modifiedAt ?? null;
          const driveModifiedAt = file.modifiedTime ?? null;

          // Skip files that haven't changed AND already have a folder path stored.
          // If the path is missing (e.g. from an earlier failed sync), re-process it.
          if (
            existing &&
            existing.hasPath &&
            existingModifiedAt &&
            driveModifiedAt &&
            new Date(existingModifiedAt) >= new Date(driveModifiedAt)
          ) {
            continue;
          }

          // Build folder path from the BFS map — no extra API calls needed.
          // file.parents[0] is the immediate parent folder; walk up via folderMap.
          const parentFolderId = file.parents?.[0] ?? null;
          const folderPath = parentFolderId ? buildFolderPath(parentFolderId, folderMap) : '';

          const row = {
            firm_id: userCtx.firmId,
            user_id: userCtx.userId,
            google_drive_file_id: file.id,
            google_drive_url: file.webViewLink ?? null,
            file_name: file.name,
            file_mime_type: file.mimeType ?? null,
            file_size_bytes: file.size ? parseInt(file.size, 10) : null,
            google_drive_folder_path: folderPath || null,
            drive_created_at: file.createdTime ?? null,
            drive_modified_at: file.modifiedTime ?? null,
            indexed_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            source: 'google_drive' as const,
          };

          const { error } = await db
            .from('vault_documents')
            .upsert(row, { onConflict: 'google_drive_file_id', ignoreDuplicates: false });

          if (!error) {
            if (existing) {
              updatedCount++;
            } else {
              newCount++;
            }
            // Clean up any agent_smith_tool duplicate rows for this file name
            await db
              .from('vault_documents')
              .delete()
              .eq('firm_id', userCtx.firmId)
              .eq('file_name', file.name)
              .eq('source', 'agent_smith_tool');
          }
        }
      } while (pageParam);
    }

    // Remove vault rows for Drive files that no longer exist (deleted or moved out of folder)
    // Only do this if we completed a full scan (didn't hit the file limit)
    if (totalProcessed < MAX_FILES) {
      const { data: allVaultDriveIds } = await db
        .from('vault_documents')
        .select('id, google_drive_file_id')
        .eq('firm_id', userCtx.firmId)
        .eq('source', 'google_drive');

      if (allVaultDriveIds && allVaultDriveIds.length > 0) {
        const idsToDelete = allVaultDriveIds
          .filter(row => !seenFileIds.has(row.google_drive_file_id))
          .map(row => row.id);

        if (idsToDelete.length > 0) {
          await db.from('vault_documents').delete().in('id', idsToDelete);
          deletedCount = idsToDelete.length;
        }
      }
    }

    // Update sync state
    await db.from('vault_sync_state').upsert(
      {
        firm_id: userCtx.firmId,
        user_id: userCtx.userId,
        last_sync_at: new Date().toISOString(),
        last_sync_status: 'success',
        total_files_indexed: newCount + updatedCount,
        last_page_token: null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'firm_id,user_id' }
    );

    return NextResponse.json({ total: totalProcessed, new: newCount, updated: updatedCount, deleted: deletedCount });
  } catch (err) {
    console.error('[/api/vault/sync]', err);
    return NextResponse.json({ error: 'Sync failed. Please try again.' }, { status: 500 });
  }
}
