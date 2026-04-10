import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getUserContext } from '@/lib/getUserContext';
import { buildModuleChecker, moduleNotActive } from '@/lib/modules';
import { createServiceClient } from '@/lib/supabase-server';

const UploadedFileSchema = z.object({
  name: z.string(),
  mimeType: z.string(),
  driveUrl: z.string(),
  driveFileId: z.string(),
  fileSizeBytes: z.number().optional(),
});

// One transaction per row — accept any shape, just pull the fields we care about
// Use catchall instead of intersection to avoid Zod v4 compatibility issues
const TransactionSchema = z.object({ fileName: z.string() }).catchall(z.unknown());

const BodySchema = z.object({
  uploadedFiles: z.array(UploadedFileSchema),
  transactions: z.array(TransactionSchema),
  clientId: z.string().nullable().optional(),
  clientCode: z.string().nullable().optional(),
  clientName: z.string().optional(),
  sourceTool: z.string().optional(),
  documentType: z.string().optional(),
});

/** Pull supplier name from whichever field the software uses */
function getSupplier(tx: Record<string, unknown>): string | null {
  return (
    (tx.details as string) ||
    (tx.contactname as string) ||
    (tx.contactName as string) ||
    (tx.supplier as string) ||
    (tx.DETAILS as string) ||
    (tx.description as string) ||
    null
  );
}

/** Pull date from whichever field the software uses */
function getDate(tx: Record<string, unknown>): string | null {
  const raw =
    (tx.date as string) ||
    (tx.invoicedate as string) ||
    (tx.invoiceDate as string) ||
    (tx.DATE as string) ||
    null;
  if (!raw) return null;
  // Normalise to YYYY-MM-DD
  const d = new Date(raw);
  return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

/** Pull gross amount from whichever field the software uses */
function getAmount(tx: Record<string, unknown>): number | null {
  const val =
    tx.total ??
    tx.grossAmount ??
    tx.amount ??
    tx.NET_AMOUNT ??
    null;
  if (val === null || val === undefined) return null;
  const n = Number(val);
  return isNaN(n) ? null : Math.abs(n);
}

export async function POST(req: NextRequest) {
  try {
    const userCtx = await getUserContext();
    if (!userCtx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
    const { isModuleActive } = buildModuleChecker(userCtx.activeModules);
    if (!isModuleActive('document-vault')) return moduleNotActive('document-vault');

    const body = await req.json();
    const parsed = BodySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 });
    }

    const { uploadedFiles, transactions, clientId, clientCode, clientName, sourceTool, documentType } = parsed.data;

    // Group transactions by source file
    const txByFile = new Map<string, typeof transactions>();
    for (const tx of transactions) {
      const existing = txByFile.get(tx.fileName) ?? [];
      existing.push(tx);
      txByFile.set(tx.fileName, existing);
    }

    const db = createServiceClient();
    const now = new Date().toISOString();
    let saved = 0;

    for (const file of uploadedFiles) {
      const fileTxs = txByFile.get(file.name) ?? [];

      // Aggregate tags across all transactions for this file
      const suppliers = [...new Set(fileTxs.map(tx => getSupplier(tx as Record<string, unknown>)).filter(Boolean))];
      const dates = fileTxs.map(tx => getDate(tx as Record<string, unknown>)).filter(Boolean);
      const amounts = fileTxs.map(tx => getAmount(tx as Record<string, unknown>)).filter((n): n is number => n !== null);
      const totalAmount = amounts.length ? amounts.reduce((a, b) => a + b, 0) : null;
      const earliestDate = dates.length ? dates.sort()[0] : null;
      const supplierName = suppliers[0] ?? null;

      const summary = [
        supplierName && `Supplier: ${supplierName}`,
        earliestDate && `Date: ${earliestDate}`,
        totalAmount !== null && `Total: £${totalAmount.toFixed(2)}`,
        clientName && `Client: ${clientName}`,
        `${fileTxs.length} transaction${fileTxs.length !== 1 ? 's' : ''} extracted`,
      ].filter(Boolean).join(' · ');

      // Upsert so re-saving doesn't duplicate vault entries
      const { error } = await db
        .from('vault_documents')
        .upsert(
          {
            firm_id: userCtx.firmId,
            user_id: userCtx.userId,
            client_id: clientId ?? null,
            google_drive_file_id: file.driveFileId,
            google_drive_url: file.driveUrl,
            file_name: file.name,
            file_mime_type: file.mimeType,
            file_size_bytes: file.fileSizeBytes ?? null,
            tag_supplier_name: supplierName,
            tag_client_code: clientCode ?? null,
            tag_client_name: clientName ?? null,
            tag_document_date: earliestDate ?? null,
            tag_amount: totalAmount,
            tag_currency: 'GBP',
            tag_document_type: documentType ?? 'invoice',
            tag_summary: summary || null,
            tags_array: [
              supplierName,
              clientCode,
              clientName,
              earliestDate,
            ].filter(Boolean) as string[],
            tagging_status: 'tagged',
            source: 'agent_smith_tool',
            source_tool: sourceTool ?? 'full_analysis',
            indexed_at: now,
            updated_at: now,
          },
          { onConflict: 'google_drive_file_id', ignoreDuplicates: false }
        );

      if (!error) saved++;
      else console.error('[save-from-analysis] vault insert error:', error);
    }

    return NextResponse.json({ saved });
  } catch (err) {
    console.error('[/api/vault/save-from-analysis]', err);
    return NextResponse.json({ error: 'Failed to save to vault.' }, { status: 500 });
  }
}
