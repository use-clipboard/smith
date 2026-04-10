import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getUserContext } from '@/lib/getUserContext';
import { getRefreshedDriveCredentials } from '@/lib/vaultHelpers';
import { createServiceClient } from '@/lib/supabase-server';

const PatchSchema = z.object({
  client_id: z.string().uuid().nullable().optional(),
  tag_supplier_name: z.string().nullable().optional(),
  tag_client_code: z.string().nullable().optional(),
  tag_client_name: z.string().nullable().optional(),
  tag_document_date: z.string().nullable().optional(),
  tag_amount: z.number().nullable().optional(),
  tag_currency: z.string().optional(),
  tag_document_type: z.string().nullable().optional(),
  tag_tax_year: z.string().nullable().optional(),
  tag_accounting_period: z.string().nullable().optional(),
  tag_hmrc_reference: z.string().nullable().optional(),
  tag_vat_number: z.string().nullable().optional(),
  tag_summary: z.string().nullable().optional(),
  tag_additional: z.record(z.string(), z.unknown()).nullable().optional(),
});

const DeleteSchema = z.object({
  delete_from_drive: z.boolean().optional().default(false),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const userCtx = await getUserContext();
    if (!userCtx) {
      return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
    }

    const body = await req.json();
    const parsed = PatchSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 });
    }

    const db = createServiceClient();

    // Verify ownership
    const { data: existing } = await db
      .from('vault_documents')
      .select('id, firm_id')
      .eq('id', params.id)
      .eq('firm_id', userCtx.firmId)
      .single();

    if (!existing) {
      return NextResponse.json({ error: 'Document not found' }, { status: 404 });
    }

    const { data: updated, error } = await db
      .from('vault_documents')
      .update({
        ...parsed.data,
        manually_edited: true,
        tagging_status: 'manually_reviewed',
        updated_at: new Date().toISOString(),
      })
      .eq('id', params.id)
      .select()
      .single();

    if (error) {
      console.error('[/api/vault/documents/[id] PATCH]', error);
      return NextResponse.json({ error: 'Update failed.' }, { status: 500 });
    }

    return NextResponse.json(updated);
  } catch (err) {
    console.error('[/api/vault/documents/[id] PATCH]', err);
    return NextResponse.json({ error: 'Update failed.' }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const userCtx = await getUserContext();
    if (!userCtx) {
      return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const parsed = DeleteSchema.safeParse(body);
    const deleteFromDrive = parsed.success ? parsed.data.delete_from_drive : false;

    const db = createServiceClient();

    // Verify ownership and get Drive file ID
    const { data: doc } = await db
      .from('vault_documents')
      .select('id, firm_id, google_drive_file_id, file_name')
      .eq('id', params.id)
      .eq('firm_id', userCtx.firmId)
      .single();

    if (!doc) {
      return NextResponse.json({ error: 'Document not found' }, { status: 404 });
    }

    // Delete from Drive if requested
    if (deleteFromDrive && doc.google_drive_file_id && !doc.google_drive_file_id.startsWith('tool:')) {
      const creds = await getRefreshedDriveCredentials(userCtx.firmId);
      if (creds) {
        try {
          await creds.drive.files.delete({ fileId: doc.google_drive_file_id });
        } catch (err) {
          console.error('[vault/delete] Drive delete failed:', err);
          return NextResponse.json({ error: 'Failed to delete from Google Drive.' }, { status: 500 });
        }
      }
    }

    // Remove from Supabase
    const { error } = await db
      .from('vault_documents')
      .delete()
      .eq('id', params.id);

    if (error) {
      console.error('[/api/vault/documents/[id] DELETE]', error);
      return NextResponse.json({ error: 'Delete failed.' }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[/api/vault/documents/[id] DELETE]', err);
    return NextResponse.json({ error: 'Delete failed.' }, { status: 500 });
  }
}
