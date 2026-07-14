import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getUserContext } from '@/lib/getUserContext';
import { getRefreshedDriveCredentials } from '@/lib/vaultHelpers';
import { createServiceClient } from '@/lib/supabase-server';

const BulkPatchSchema = z.object({
  ids: z.array(z.string().uuid()).min(1),
  updates: z.object({
    client_id: z.string().uuid().nullable().optional(),
    tag_document_type: z.string().nullable().optional(),
    tag_supplier_name: z.string().nullable().optional(),
    tag_client_code: z.string().nullable().optional(),
    tag_client_name: z.string().nullable().optional(),
    tag_tax_year: z.string().nullable().optional(),
  }),
});

const BulkDeleteSchema = z.object({
  ids: z.array(z.string().uuid()).min(1),
  delete_from_drive: z.boolean().optional().default(false),
});

export async function PATCH(req: NextRequest) {
  try {
    const userCtx = await getUserContext();
    if (!userCtx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

    const body = await req.json();
    const parsed = BulkPatchSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 });
    }

    const { ids, updates } = parsed.data;
    const db = createServiceClient();

    // Strip undefined fields so we only update what was provided
    const patch = Object.fromEntries(
      Object.entries(updates).filter(([, v]) => v !== undefined)
    );

    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
    }

    const { error } = await db
      .from('vault_documents')
      .update({
        ...patch,
        manually_edited: true,
        tagging_status: 'manually_reviewed',
        updated_at: new Date().toISOString(),
      })
      .in('id', ids)
      .eq('firm_id', userCtx.firmId);

    if (error) {
      console.error('[vault/documents/bulk PATCH]', error);
      return NextResponse.json({ error: 'Update failed.' }, { status: 500 });
    }

    return NextResponse.json({ updated: ids.length });
  } catch (err) {
    console.error('[vault/documents/bulk PATCH]', err);
    return NextResponse.json({ error: 'Update failed.' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const userCtx = await getUserContext();
    if (!userCtx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

    const body = await req.json();
    const parsed = BulkDeleteSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
    }

    const { ids, delete_from_drive } = parsed.data;
    const db = createServiceClient();

    // Verify all docs belong to this firm and get Drive IDs if needed
    const { data: docs } = await db
      .from('vault_documents')
      .select('id, google_drive_file_id')
      .in('id', ids)
      .eq('firm_id', userCtx.firmId);

    if (!docs?.length) {
      return NextResponse.json({ error: 'No documents found' }, { status: 404 });
    }

    const verifiedIds = docs.map(d => d.id);

    // Delete from Drive if requested (skip pseudo IDs)
    let driveFailures = 0;
    if (delete_from_drive) {
      const creds = await getRefreshedDriveCredentials(userCtx.firmId);
      if (creds) {
        const driveDocs = docs.filter(
          d => d.google_drive_file_id && !d.google_drive_file_id.startsWith('tool:')
        );
        // supportsAllDrives is required for files that live in a Shared Drive —
        // without it the API scopes to My Drive and returns 404 for shared-drive files.
        const results = await Promise.allSettled(
          driveDocs.map(d =>
            creds.drive.files.delete({ fileId: d.google_drive_file_id, supportsAllDrives: true })
          )
        );
        results.forEach((r, i) => {
          if (r.status === 'rejected') {
            driveFailures++;
            console.error(
              `[vault/documents/bulk DELETE] Drive delete failed for ${driveDocs[i].google_drive_file_id}:`,
              r.reason
            );
          }
        });
      }
    }

    // If any Drive delete failed, do NOT remove the vault rows — otherwise the
    // next Drive sync silently re-imports the surviving files and they reappear.
    if (driveFailures > 0) {
      return NextResponse.json(
        { error: `Failed to delete ${driveFailures} file(s) from Google Drive. Nothing was removed — please try again.` },
        { status: 502 }
      );
    }

    const { error } = await db
      .from('vault_documents')
      .delete()
      .in('id', verifiedIds);

    if (error) {
      console.error('[vault/documents/bulk DELETE]', error);
      return NextResponse.json({ error: 'Delete failed.' }, { status: 500 });
    }

    return NextResponse.json({ deleted: verifiedIds.length });
  } catch (err) {
    console.error('[vault/documents/bulk DELETE]', err);
    return NextResponse.json({ error: 'Delete failed.' }, { status: 500 });
  }
}
