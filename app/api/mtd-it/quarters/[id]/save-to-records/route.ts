import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient, createServiceClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';
import { uploadDocumentsToDrive } from '@/lib/driveUpload';
import { taxYearLabel } from '@/lib/mtdIt/quarters';

// POST /api/mtd-it/quarters/[id]/save-to-records
//   Saves the quarter's generated PDFs + source documents to the firm's
//   Google Drive and/or Document Vault.
//
// The client generates the PDFs (P&L + approval pack) using the same
// renderer that the email + download buttons use, and passes them as
// base64 here. Source documents live in the mtd-it-source-docs bucket
// already; we pipe them straight from supabase to Drive without a
// client round-trip.

const BodySchema = z.object({
  /** P&L PDF as base64 (no data: prefix). Omit to skip saving the report. */
  pnl_pdf_base64:      z.string().optional(),
  /** Approval pack PDF as base64. Omit to skip. */
  approval_pdf_base64: z.string().optional(),
  /** When true, every file in mtd-it-source-docs/{quarter_id}/ is mirrored
   *  to Drive + indexed in the vault. */
  include_source_docs: z.boolean().optional(),
  /** Save destinations. The endpoint applies the firm's active modules
   *  internally — passing 'drive: true' when the module is off is a no-op. */
  destination_drive:   z.boolean().optional(),
  destination_vault:   z.boolean().optional(),
  /** Optional override for the client code used in folder naming.
   *  Defaults to the client's stored client_ref. */
  client_code:         z.string().nullable().optional(),
  /** When set, files land directly in this Drive folder instead of the
   *  default {root}/{client_code}/MTD IT/{today} hierarchy. Picked via
   *  the DriveFolderPicker in the Save-to-records modal. */
  drive_folder_id:     z.string().nullable().optional(),
}).strict();

interface UploadedFile { name: string; driveUrl: string; driveFileId: string; mimeType?: string; sizeBytes?: number; }

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' }, { status: 400 });
  const { pnl_pdf_base64, approval_pdf_base64, include_source_docs, destination_drive, destination_vault, client_code, drive_folder_id } = parsed.data;

  const driveActive = destination_drive && ctx.activeModules.includes('google-drive');
  const vaultActive = destination_vault && ctx.activeModules.includes('document-vault');
  if (!driveActive && !vaultActive) {
    return NextResponse.json({ error: 'No destination selected — Drive or Vault must be active and chosen.' }, { status: 400 });
  }

  // Firm-scope check + load the quarter + client metadata for filenames/folders
  const supabase = createClient();
  const { data: q } = await supabase
    .from('mtd_it_quarters')
    .select('id, client_id, tax_year, quarter, clients!inner(id, name, client_ref, firm_id)')
    .eq('id', params.id)
    .maybeSingle();
  const client = (q as unknown as { clients?: { id?: string; name?: string; client_ref?: string | null; firm_id?: string } } | null)?.clients;
  if (!q || client?.firm_id !== ctx.firmId) {
    return NextResponse.json({ error: 'Quarter not found' }, { status: 404 });
  }

  const taxYear   = (q as { tax_year: number }).tax_year;
  const quarter   = (q as { quarter: number }).quarter;
  const yearLabel = taxYearLabel(taxYear);
  const effectiveCode = (client_code ?? client?.client_ref ?? '').trim();
  // Stable filename prefix so re-runs replace the same file in Drive.
  const baseName = `${effectiveCode || (client?.name ?? 'client')}_MTD-IT_Q${quarter}_${yearLabel.replace('/', '-')}`;

  // ── Collect the files we're going to push ─────────────────────────────
  type Payload = { name: string; mimeType: string; base64: string; sizeBytes: number };
  const payloads: Payload[] = [];

  if (pnl_pdf_base64) {
    const buf = Buffer.from(pnl_pdf_base64, 'base64');
    payloads.push({ name: `${baseName}_P&L.pdf`,           mimeType: 'application/pdf', base64: pnl_pdf_base64,      sizeBytes: buf.byteLength });
  }
  if (approval_pdf_base64) {
    const buf = Buffer.from(approval_pdf_base64, 'base64');
    payloads.push({ name: `${baseName}_Approval-pack.pdf`, mimeType: 'application/pdf', base64: approval_pdf_base64, sizeBytes: buf.byteLength });
  }

  const service = createServiceClient();

  // Pull source documents from supabase storage if requested.
  // We use the service client so the listing works regardless of the
  // caller's RLS context.
  if (include_source_docs) {
    try {
      const { data: listed, error: listErr } = await service.storage
        .from('mtd-it-source-docs')
        .list(params.id, { limit: 500 });
      if (listErr) console.warn('save-to-records source list', listErr);
      else if (listed) {
        for (const f of listed) {
          try {
            const { data: blob } = await service.storage.from('mtd-it-source-docs').download(`${params.id}/${f.name}`);
            if (!blob) continue;
            const buf = Buffer.from(await blob.arrayBuffer());
            payloads.push({
              name: f.name,
              mimeType: blob.type || 'application/octet-stream',
              base64: buf.toString('base64'),
              sizeBytes: buf.byteLength,
            });
          } catch (e) {
            console.warn('save-to-records source download', f.name, e);
          }
        }
      }
    } catch (e) {
      console.warn('save-to-records source list error', e);
    }
  }

  if (payloads.length === 0) {
    return NextResponse.json({ error: 'Nothing selected to save.' }, { status: 400 });
  }

  // ── Drive upload (only if module active + Drive selected) ──────────────
  let uploaded: UploadedFile[] = [];
  if (driveActive) {
    try {
      const driveFiles = await uploadDocumentsToDrive({
        files: payloads.map(p => ({ name: p.name, mimeType: p.mimeType, base64: p.base64 })),
        clientId:       client?.id ?? null,
        clientCode:     effectiveCode || null,
        userId:         ctx.userId,
        firmId:         ctx.firmId,
        feature:        'mtd_it',
        customFolderId: drive_folder_id ?? null,
      });
      uploaded = driveFiles.map(d => {
        const match = payloads.find(p => p.name === d.name);
        return { ...d, mimeType: match?.mimeType, sizeBytes: match?.sizeBytes };
      });
    } catch (e) {
      console.error('save-to-records drive', e);
      return NextResponse.json({ error: e instanceof Error ? e.message : 'Drive upload failed' }, { status: 502 });
    }
  }

  // ── Write Drive URLs back onto the entries so the editor + PDF can
  //    surface them as clickable links. Matches by source_file_name —
  //    every entry sharing a filename gets the same URL. Manual entries
  //    (no source_file_name) keep their existing drive_link, if any. ────
  if (uploaded.length > 0) {
    for (const u of uploaded) {
      // Skip the two report files — only source-doc URLs belong on entries.
      if (u.name.endsWith('_P&L.pdf') || u.name.endsWith('_Approval-pack.pdf')) continue;
      try {
        await service
          .from('mtd_it_entries')
          .update({ drive_link: u.driveUrl })
          .eq('quarter_id', params.id)
          .eq('source_file_name', u.name);
      } catch (e) {
        console.warn('save-to-records entry drive_link update', u.name, e);
      }
    }
  }

  // Source-doc cleanup now lives in /cleanup-source — fired by the modal
  // on close when triggered by Save & complete + the firm setting is on.
  // Keeps this endpoint focused on uploads.

  // ── Vault indexing (only if module active + Vault selected) ────────────
  let vaultCount = 0;
  if (vaultActive) {
    // We index everything we attempted, even if Drive was off — the vault
    // row still records the file metadata, just without a Drive link.
    const rowsToInsert = (uploaded.length > 0 ? uploaded : payloads.map(p => ({
      name: p.name, driveUrl: '', driveFileId: '', mimeType: p.mimeType, sizeBytes: p.sizeBytes,
    }))).map(u => {
      const isPdfReport = u.name.endsWith('_P&L.pdf') || u.name.endsWith('_Approval-pack.pdf');
      const docType = isPdfReport ? 'mtd_it_report' : 'mtd_it_source';
      return {
        firm_id:               ctx.firmId,
        user_id:               ctx.userId,
        client_id:             client?.id ?? null,
        file_name:             u.name,
        file_mime_type:        u.mimeType ?? 'application/pdf',
        file_size_bytes:       u.sizeBytes ?? null,
        google_drive_file_id:  u.driveFileId || null,
        google_drive_url:      u.driveUrl    || null,
        tag_document_type:     docType,
        tag_document_date:     new Date().toISOString().slice(0, 10),
        tag_client_name:       client?.name ?? null,
        tag_client_code:       effectiveCode || null,
        tag_summary:           `MTD IT ${docType === 'mtd_it_report' ? 'report' : 'source document'} — Q${quarter} ${yearLabel}`,
        tagging_status:        'tagged',
        source:                'agent_smith_tool',
        source_tool:           'mtd_it',
        indexed_at:            new Date().toISOString(),
        updated_at:            new Date().toISOString(),
      };
    });
    const { error: vErr, count } = await service.from('vault_documents').insert(rowsToInsert, { count: 'exact' });
    if (vErr) {
      console.error('save-to-records vault insert', vErr);
      // Drive succeeded, vault failed — surface as a soft warning rather
      // than a hard failure (Drive already has the files).
    } else {
      vaultCount = count ?? rowsToInsert.length;
    }
  }

  return NextResponse.json({
    ok: true,
    summary: {
      drive_uploaded: uploaded.length,
      vault_indexed:  vaultCount,
      attempted:      payloads.length,
    },
  });
}
