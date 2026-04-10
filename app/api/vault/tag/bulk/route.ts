import { NextRequest } from 'next/server';
import { z } from 'zod';
import { getUserContext } from '@/lib/getUserContext';
import { getAnthropicForFirm } from '@/lib/getAnthropicForFirm';
import { getDriveCredentials, fetchFileFromDrive, tagDocumentWithClaude, applyTagsToDocument } from '@/lib/vaultHelpers';
import { createServiceClient } from '@/lib/supabase-server';

const RequestSchema = z.object({
  vault_document_ids: z.array(z.string().uuid()).optional(),
});

const BATCH_SIZE = 5;

export async function POST(req: NextRequest) {
  const userCtx = await getUserContext();
  if (!userCtx) {
    return new Response(JSON.stringify({ error: 'Unauthorised' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const body = await req.json().catch(() => ({}));
  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) {
    return new Response(JSON.stringify({ error: 'Invalid request' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const creds = await getDriveCredentials(userCtx.firmId);
  if (!creds) {
    return new Response(JSON.stringify({ error: 'Google Drive not connected' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let anthropic;
  try {
    anthropic = await getAnthropicForFirm(userCtx.firmId);
  } catch {
    return new Response(JSON.stringify({ error: 'No AI API key configured for your firm. Please ask your admin to add one in Settings → AI & API Key.' }), {
      status: 402,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const db = createServiceClient();

  // Resolve which documents to tag
  let query = db
    .from('vault_documents')
    .select('id, google_drive_file_id, file_name, file_mime_type')
    .eq('firm_id', userCtx.firmId);

  if (parsed.data.vault_document_ids?.length) {
    query = query.in('id', parsed.data.vault_document_ids);
  } else {
    query = query.in('tagging_status', ['untagged', 'failed']);
  }

  const { data: docs } = await query;
  if (!docs || docs.length === 0) {
    return new Response(JSON.stringify({ total: 0, completed: 0, failed: 0 }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // SSE response
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: object) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };

      const total = docs.length;
      let completed = 0;
      let failed = 0;

      send({ type: 'start', total });

      // Process in batches
      for (let i = 0; i < docs.length; i += BATCH_SIZE) {
        const batch = docs.slice(i, i + BATCH_SIZE);

        await Promise.all(
          batch.map(async doc => {
            try {
              await db
                .from('vault_documents')
                .update({ tagging_status: 'pending', updated_at: new Date().toISOString() })
                .eq('id', doc.id);

              const fileBuffer = await fetchFileFromDrive(
                creds.accessToken,
                creds.refreshToken,
                doc.google_drive_file_id
              );

              const tags = await tagDocumentWithClaude(
                fileBuffer,
                doc.file_mime_type ?? 'application/octet-stream',
                doc.file_name,
                anthropic
              );

              await applyTagsToDocument(doc.id, tags);
              completed++;
              send({ type: 'progress', total, completed, failed, documentId: doc.id, status: 'tagged' });
            } catch (err) {
              const msg = err instanceof Error ? err.message : 'Unknown error';
              await db.from('vault_documents').update({
                tagging_status: 'failed',
                tagging_error: msg,
                updated_at: new Date().toISOString(),
              }).eq('id', doc.id);
              failed++;
              send({ type: 'progress', total, completed, failed, documentId: doc.id, status: 'failed', error: msg });
            }
          })
        );
      }

      send({ type: 'done', total, completed, failed });
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}
