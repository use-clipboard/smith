/**
 * Shared helpers for Document Vault API routes.
 * Server-side only — do not import from client components.
 */
import { createServiceClient } from '@/lib/supabase-server';
import { getDriveClient, getRefreshedDriveClient } from '@/lib/googleDrive';
import Anthropic from '@anthropic-ai/sdk';
import { VAULT_TAGGER_SYSTEM_PROMPT } from '@/prompts/vault-tagger';
import type { VaultTaggerResult, VaultDocumentType } from '@/types';

/** Fetch Google Drive credentials for a firm from firm_settings */
export async function getDriveCredentials(firmId: string) {
  const db = createServiceClient();
  const { data: settings } = await db
    .from('firm_settings')
    .select('google_drive_enabled, google_access_token, google_refresh_token, google_drive_folder_id')
    .eq('firm_id', firmId)
    .single();

  if (
    !settings?.google_drive_enabled ||
    !settings.google_access_token ||
    !settings.google_refresh_token
  ) {
    return null;
  }

  return {
    accessToken: settings.google_access_token as string,
    refreshToken: settings.google_refresh_token as string,
    rootFolderId: settings.google_drive_folder_id as string | null,
  };
}

/**
 * Like getDriveCredentials but also refreshes the OAuth access token,
 * persists the new token to firm_settings, and returns a ready drive client.
 * Use this anywhere you need to make Drive API calls.
 */
export async function getRefreshedDriveCredentials(firmId: string) {
  const db = createServiceClient();
  const { data: settings } = await db
    .from('firm_settings')
    .select('google_drive_enabled, google_refresh_token, google_drive_folder_id')
    .eq('firm_id', firmId)
    .single();

  if (!settings?.google_drive_enabled || !settings.google_refresh_token) {
    return null;
  }

  const refreshToken = settings.google_refresh_token as string;
  const { drive, accessToken } = await getRefreshedDriveClient(refreshToken);

  // Persist the fresh token so subsequent requests don't hit stale stored value
  await db.from('firm_settings').update({ google_access_token: accessToken }).eq('firm_id', firmId);

  return {
    drive,
    accessToken,
    refreshToken,
    rootFolderId: settings.google_drive_folder_id as string | null,
  };
}

/** Fetch file content from Google Drive as a Buffer */
export async function fetchFileFromDrive(
  accessToken: string,
  refreshToken: string,
  fileId: string
): Promise<Buffer> {
  const drive = await getDriveClient(accessToken, refreshToken);
  const response = await drive.files.get(
    { fileId, alt: 'media' },
    { responseType: 'arraybuffer' }
  );
  return Buffer.from(response.data as ArrayBuffer);
}

/** Build a tags_array from all non-null string/number tag values */
export function buildTagsArray(tags: VaultTaggerResult): string[] {
  const values: string[] = [];
  const add = (v: unknown) => {
    if (typeof v === 'string' && v.trim()) values.push(v.trim());
    if (typeof v === 'number') values.push(String(v));
  };
  add(tags.supplier_name);
  add(tags.client_code);
  add(tags.client_name);
  add(tags.document_type);
  add(tags.tax_year);
  add(tags.accounting_period);
  add(tags.hmrc_reference);
  add(tags.vat_number);
  add(tags.invoice_number);
  add(tags.summary);
  add(tags.currency);
  if (tags.additional) {
    Object.values(tags.additional).forEach(add);
  }
  return [...new Set(values)];
}

const SUPPORTED_PDF_TYPES = ['application/pdf'];
const SUPPORTED_IMAGE_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
const SUPPORTED_TEXT_TYPES = [
  'text/plain', 'text/csv', 'text/tab-separated-values',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
];

/**
 * Call Claude to tag a document.
 * Returns parsed VaultTaggerResult or throws on failure.
 */
export async function tagDocumentWithClaude(
  fileBuffer: Buffer,
  mimeType: string,
  fileName: string,
  anthropic: Anthropic
): Promise<VaultTaggerResult> {
  const userContent: Anthropic.Messages.MessageParam['content'] = [];

  if (SUPPORTED_PDF_TYPES.includes(mimeType)) {
    userContent.push({
      type: 'document',
      source: {
        type: 'base64',
        media_type: 'application/pdf',
        data: fileBuffer.toString('base64'),
      },
    } as never);
  } else if (SUPPORTED_IMAGE_TYPES.includes(mimeType)) {
    const validImageType = mimeType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';
    userContent.push({
      type: 'image',
      source: {
        type: 'base64',
        media_type: validImageType,
        data: fileBuffer.toString('base64'),
      },
    } as never);
  } else if (SUPPORTED_TEXT_TYPES.includes(mimeType)) {
    userContent.push({
      type: 'text',
      text: `File: ${fileName}\n\n${fileBuffer.toString('utf-8').slice(0, 10000)}`,
    });
  } else {
    throw new Error(`Unsupported file type for tagging: ${mimeType}`);
  }

  userContent.push({
    type: 'text',
    text: `Please analyse this document (filename: "${fileName}") and extract all metadata as JSON.`,
  });

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1024,
    system: VAULT_TAGGER_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userContent }],
  });

  const textBlock = response.content.find(c => c.type === 'text');
  if (!textBlock || textBlock.type !== 'text') {
    throw new Error('No text response from Claude');
  }

  let json = textBlock.text.trim();
  if (json.startsWith('```json')) json = json.slice(7).trim();
  if (json.startsWith('```')) json = json.slice(3).trim();
  if (json.endsWith('```')) json = json.slice(0, -3).trim();

  const parsed = JSON.parse(json) as VaultTaggerResult;
  return parsed;
}

/**
 * Apply Claude tags to a vault_documents row.
 * Updates the row in Supabase and returns the updated row.
 */
export async function applyTagsToDocument(
  documentId: string,
  tags: VaultTaggerResult
): Promise<void> {
  const db = createServiceClient();
  const tagsArray = buildTagsArray(tags);

  await db
    .from('vault_documents')
    .update({
      tag_supplier_name: tags.supplier_name,
      tag_client_code: tags.client_code,
      tag_client_name: tags.client_name,
      tag_document_date: tags.document_date,
      tag_amount: tags.amount,
      tag_currency: tags.currency ?? 'GBP',
      tag_document_type: tags.document_type as VaultDocumentType | null,
      tag_tax_year: tags.tax_year,
      tag_accounting_period: tags.accounting_period,
      tag_hmrc_reference: tags.hmrc_reference,
      tag_vat_number: tags.vat_number,
      tag_additional: {
        vat_amount: tags.vat_amount,
        net_amount: tags.net_amount,
        invoice_number: tags.invoice_number,
        account_number: tags.account_number,
        sort_code: tags.sort_code,
        property_address: tags.property_address,
        period_from: tags.period_from,
        period_to: tags.period_to,
        ...(tags.additional ?? {}),
      },
      tag_summary: tags.summary,
      tag_confidence: tags.confidence,
      tags_array: tagsArray,
      tagging_status: 'tagged',
      tagging_error: null,
      tagged_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', documentId);
}

/** Get folder path string for a Drive file by traversing its parents */
export async function getDriveFolderPath(
  drive: Awaited<ReturnType<typeof getDriveClient>>,
  fileId: string
): Promise<string> {
  try {
    const fileRes = await drive.files.get({
      fileId,
      fields: 'parents,name',
    });
    const parents = fileRes.data.parents;
    if (!parents || parents.length === 0) return '';

    const parts: string[] = [];
    let currentId = parents[0];
    for (let i = 0; i < 6; i++) {
      // traverse up to 6 levels
      const parentRes = await drive.files.get({
        fileId: currentId,
        fields: 'id,name,parents',
      });
      if (parentRes.data.name === 'My Drive' || !parentRes.data.name) break;
      parts.unshift(parentRes.data.name!);
      const nextParents = parentRes.data.parents;
      if (!nextParents || nextParents.length === 0) break;
      currentId = nextParents[0];
    }
    return parts.join('/');
  } catch {
    return '';
  }
}
