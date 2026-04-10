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
    if (delete_from_drive) {
      const creds = await getRefreshedDriveCredentials(userCtx.firmId);
      if (creds) {
        await Promise.allSettled(
          docs
            .filter(d => d.google_drive_file_id && !d.google_drive_file_id.startsWith('tool:'))
            .map(d => creds.drive.files.delete({ fileId: d.google_drive_file_id }))
        );
      }
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
