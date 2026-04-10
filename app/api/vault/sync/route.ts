import { NextRequest, NextResponse } from 'next/server';
import type { drive_v3 } from 'googleapis';
import { getUserContext } from '@/lib/getUserContext';
import { buildModuleChecker, moduleNotActive } from '@/lib/modules';
import { getRefreshedDriveCredentials, getDriveFolderPath } from '@/lib/vaultHelpers';
import { createServiceClient } from '@/lib/supabase-server';

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

    // Load existing sync state to get last page token for incremental sync
    const { data: syncState } = await db
      .from('vault_sync_state')
      .select('last_page_token')
      .eq('firm_id', userCtx.firmId)
      .eq('user_id', userCtx.userId)
      .maybeSingle();

    let pageToken: string | undefined = syncState?.last_page_token ?? undefined;
    let newCount = 0;
    let updatedCount = 0;
    let deletedCount = 0;
    let totalProcessed = 0;
    let nextPageToken: string | undefined;
    const seenFileIds = new Set<string>();

    const BATCH_SIZE = 100;
    let pageParam: string | undefined = undefined;

    // Build parent folder filter — scope sync to the selected root folder and its direct subfolders
    let parentFilter = '';
    if (rootFolderId) {
      try {
        const subRes = await drive.files.list({
          q: `mimeType = 'application/vnd.google-apps.folder' and '${rootFolderId}' in parents and trashed = false`,
          fields: 'files(id)',
          pageSize: 200,
          supportsAllDrives: true,
          includeItemsFromAllDrives: true,
        });
        const parentIds = [rootFolderId, ...(subRes.data.files ?? []).map((f: drive_v3.Schema$File) => f.id!).filter(Boolean)];
        const parentsClause = parentIds.map(id => `'${id}' in parents`).join(' or ');
        parentFilter = ` and (${parentsClause})`;
      } catch {
        // Fall back to unscoped sync if subfolder enumeration fails
      }
    }

    // Paginate through files in the selected folder
    do {
      const listRes: { data: drive_v3.Schema$FileList } = await drive.files.list({
        q: `trashed = false and mimeType != 'application/vnd.google-apps.folder'${parentFilter}`,
        fields: 'nextPageToken, files(id, name, mimeType, size, webViewLink, createdTime, modifiedTime, parents)',
        pageSize: BATCH_SIZE,
        pageToken: pageParam,
        orderBy: 'modifiedTime desc',
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
      });

      const files = listRes.data.files ?? [];
      pageParam = listRes.data.nextPageToken ?? undefined;

      // On incremental syncs: stop once we've caught up to the last sync time
      // (files are sorted newest first)
      const { data: existingDocs } = await db
        .from('vault_documents')
        .select('google_drive_file_id, drive_modified_at')
        .eq('firm_id', userCtx.firmId)
        .in('google_drive_file_id', files.map((f: drive_v3.Schema$File) => f.id!).filter(Boolean));

      const existingMap = new Map(
        (existingDocs ?? []).map(d => [d.google_drive_file_id, d.drive_modified_at])
      );

      for (const file of files) {
        if (!file.id || !file.name) continue;

        totalProcessed++;
        seenFileIds.add(file.id);
        const existingModifiedAt = existingMap.get(file.id);
        const driveModifiedAt = file.modifiedTime ?? null;

        // Skip files that haven't changed since last index
        if (
          existingModifiedAt &&
          driveModifiedAt &&
          new Date(existingModifiedAt) >= new Date(driveModifiedAt)
        ) {
          continue;
        }

        // Get folder path (fire-and-forget — don't block if it fails)
        let folderPath = '';
        try {
          folderPath = await getDriveFolderPath(drive, file.id);
        } catch {
          // ignore
        }

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
          if (existingMap.has(file.id)) {
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

      // Stop at 1000 files to avoid timeouts
      if (totalProcessed >= 1000) break;
    } while (pageParam);

    void pageToken; // suppress unused warning

    // Remove vault rows for Drive files that no longer exist (deleted or moved out of folder)
    // Only do this if we completed a full scan (didn't hit the 1000-file limit)
    if (totalProcessed < 1000) {
      const { data: allVaultDriveIds } = await db
        .from('vault_documents')
        .select('id, google_drive_file_id')
        .eq('firm_id', userCtx.firmId)
        .eq('source', 'google_drive');

      if (allVaultDriveIds && allVaultDriveIds.length > 0) {
        // seenFileIds collected across all pages
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
        last_page_token: nextPageToken ?? null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'firm_id,user_id' }
    );

    void nextPageToken;

    return NextResponse.json({ total: totalProcessed, new: newCount, updated: updatedCount, deleted: deletedCount });
  } catch (err) {
    console.error('[/api/vault/sync]', err);
    return NextResponse.json({ error: 'Sync failed. Please try again.' }, { status: 500 });
  }
}
