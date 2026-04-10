import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getUserContext } from '@/lib/getUserContext';
import { getAnthropicForFirm, ApiKeyNotConfiguredError } from '@/lib/getAnthropicForFirm';
import { getDriveCredentials, fetchFileFromDrive, tagDocumentWithClaude, applyTagsToDocument } from '@/lib/vaultHelpers';
import { createServiceClient } from '@/lib/supabase-server';

const RequestSchema = z.object({
  vault_document_id: z.string().uuid(),
});

export async function POST(req: NextRequest) {
  try {
    const userCtx = await getUserContext();
    if (!userCtx) {
      return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
    }

    const body = await req.json();
    const parsed = RequestSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 });
    }

    const db = createServiceClient();

    // Load the document — verify it belongs to this firm
    const { data: doc, error: fetchError } = await db
      .from('vault_documents')
      .select('*')
      .eq('id', parsed.data.vault_document_id)
      .eq('firm_id', userCtx.firmId)
      .single();

    if (fetchError || !doc) {
      return NextResponse.json({ error: 'Document not found' }, { status: 404 });
    }

    // Mark as pending
    await db
      .from('vault_documents')
      .update({ tagging_status: 'pending', updated_at: new Date().toISOString() })
      .eq('id', doc.id);

    // Get Drive credentials
    const creds = await getDriveCredentials(userCtx.firmId);
    if (!creds) {
      await db.from('vault_documents').update({
        tagging_status: 'failed',
        tagging_error: 'Google Drive not connected',
        updated_at: new Date().toISOString(),
      }).eq('id', doc.id);
      return NextResponse.json({ error: 'Google Drive not connected' }, { status: 400 });
    }

    // Fetch file content from Drive
    let fileBuffer: Buffer;
    try {
      fileBuffer = await fetchFileFromDrive(creds.accessToken, creds.refreshToken, doc.google_drive_file_id);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to fetch file from Drive';
      await db.from('vault_documents').update({
        tagging_status: 'failed',
        tagging_error: msg,
        updated_at: new Date().toISOString(),
      }).eq('id', doc.id);
      return NextResponse.json({ error: msg }, { status: 500 });
    }

    // Call Claude to tag
    const anthropic = await getAnthropicForFirm(userCtx.firmId);
    let tags;
    try {
      tags = await tagDocumentWithClaude(fileBuffer, doc.file_mime_type ?? 'application/octet-stream', doc.file_name, anthropic);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Tagging failed';
      await db.from('vault_documents').update({
        tagging_status: 'failed',
        tagging_error: msg,
        updated_at: new Date().toISOString(),
      }).eq('id', doc.id);
      return NextResponse.json({ error: msg }, { status: 500 });
    }

    // Apply tags to DB
    await applyTagsToDocument(doc.id, tags);

    // Return updated document
    const { data: updated } = await db
      .from('vault_documents')
      .select('*')
      .eq('id', doc.id)
      .single();

    return NextResponse.json(updated);
  } catch (err) {
    if (err instanceof ApiKeyNotConfiguredError) {
      return NextResponse.json({ error: err.message }, { status: 402 });
    }
    console.error('[/api/vault/tag/single]', err);
    return NextResponse.json({ error: 'Tagging failed. Please try again.' }, { status: 500 });
  }
}
