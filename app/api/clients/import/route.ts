import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';

const CLIENT_TYPES = [
  'sole_trader', 'partnership', 'limited_company',
  'individual', 'trust', 'charity', 'rental_landlord', '',
] as const;

const LINK_TYPES = [
  'director', 'shareholder', 'spouse_partner', 'trustee',
  'beneficiary', 'associated_company', 'parent_company',
  'subsidiary', 'guarantor', 'other', '',
] as const;

const ClientRowSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  client_ref: z.string().min(1, 'Client reference is required'),
  business_type: z.enum(CLIENT_TYPES).optional().transform(v => v || null),
  contact_email: z.string().email('Invalid email').optional().or(z.literal('')).transform(v => v || null),
  status: z.enum(['active', 'hold', 'inactive']).optional().default('active'),
  linked_to_ref: z.string().optional(),
  link_type: z.enum(LINK_TYPES).optional().transform(v => v || 'other'),
  // extended fields
  address: z.string().optional(),
  utr_number: z.string().optional(),
  registration_number: z.string().optional(),
  national_insurance_number: z.string().optional(),
  companies_house_id: z.string().optional(),
  vat_number: z.string().optional(),
  companies_house_auth_code: z.string().optional(),
  date_of_birth: z.string().optional(),
  contact_number: z.string().optional(),
  paye_reference: z.string().optional(),
  paye_accounts_office_reference: z.string().optional(),
  vat_submit_type: z.enum(['Cash', 'Accrual', '']).optional().transform(v => v || null),
  vat_scheme: z.enum(['Monthly', 'Quarterly', 'Yearly', '']).optional().transform(v => v || null),
  year_end: z.string().optional(),
  mtd_it: z.boolean().optional().default(false),
});

const ImportSchema = z.object({
  rows: z.array(ClientRowSchema).min(1).max(5000),
});

export async function POST(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const parsed = ImportSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' }, { status: 400 });

  const supabase = createClient();
  const { rows } = parsed.data;

  const { data: existingClients } = await supabase
    .from('clients').select('id, client_ref').eq('firm_id', ctx.firmId).limit(100000);

  const existingRefToId = new Map<string, string>(
    (existingClients ?? []).map(c => [c.client_ref?.toUpperCase() ?? '', c.id])
  );

  const imported: string[] = [];
  const skipped: { name: string; reason: string }[] = [];

  // Separate duplicates: check against DB AND against earlier rows in this CSV
  const seenRefsInCsv = new Set<string>();
  const toInsert = rows.filter(row => {
    const refKey = row.client_ref?.toUpperCase();
    if (refKey && existingRefToId.has(refKey)) {
      skipped.push({ name: row.name, reason: `Client ref "${row.client_ref}" already exists` });
      return false;
    }
    if (refKey && seenRefsInCsv.has(refKey)) {
      skipped.push({ name: row.name, reason: `Duplicate client ref "${row.client_ref}" in this file` });
      return false;
    }
    if (refKey) seenRefsInCsv.add(refKey);
    return true;
  });

  function buildInsertRow(row: typeof rows[number]) {
    return {
      firm_id: ctx!.firmId,
      name: row.name,
      client_ref: row.client_ref || null,
      business_type: row.business_type ?? null,
      contact_email: row.contact_email ?? null,
      status: row.status ?? 'active',
      address: row.address || null,
      utr_number: row.utr_number || null,
      registration_number: row.registration_number || null,
      national_insurance_number: row.national_insurance_number || null,
      companies_house_id: row.companies_house_id || null,
      vat_number: row.vat_number || null,
      companies_house_auth_code: row.companies_house_auth_code || null,
      date_of_birth: row.date_of_birth || null,
      contact_number: row.contact_number || null,
      paye_reference: row.paye_reference || null,
      paye_accounts_office_reference: row.paye_accounts_office_reference || null,
      vat_submit_type: row.vat_submit_type ?? null,
      vat_scheme: row.vat_scheme ?? null,
      year_end: row.year_end || null,
      mtd_it: row.mtd_it ?? false,
    };
  }

  // Batch insert in chunks to avoid request timeouts on large imports
  const CHUNK_SIZE = 200;
  for (let i = 0; i < toInsert.length; i += CHUNK_SIZE) {
    const chunk = toInsert.slice(i, i + CHUNK_SIZE);
    const { data: created, error } = await supabase
      .from('clients')
      .insert(chunk.map(buildInsertRow))
      .select('id, client_ref');

    if (error || !created) {
      // Chunk failed — fall back to per-row so we can report individual errors
      for (const row of chunk) {
        const { data: single, error: rowError } = await supabase
          .from('clients')
          .insert(buildInsertRow(row))
          .select('id')
          .single();
        if (rowError || !single) {
          const reason = rowError?.code === '23505'
            ? `Client ref "${row.client_ref}" already exists`
            : rowError?.message
              ? `Database error: ${rowError.message}`
              : 'Database error — please try again';
          skipped.push({ name: row.name, reason });
          console.error('[clients/import] Insert error:', rowError);
        } else {
          imported.push(row.name);
          const refKey = row.client_ref?.toUpperCase();
          if (refKey) existingRefToId.set(refKey, single.id);
        }
      }
    } else {
      const idByRef = new Map(created.map(c => [c.client_ref?.toUpperCase() ?? '', c.id]));
      for (const row of chunk) {
        const refKey = row.client_ref?.toUpperCase() ?? '';
        const id = idByRef.get(refKey);
        if (id) {
          imported.push(row.name);
          if (refKey) existingRefToId.set(refKey, id);
        } else {
          skipped.push({ name: row.name, reason: 'Database error — please try again' });
        }
      }
    }
  }

  // Process links — collect all and bulk upsert to avoid per-row round trips
  const linkSkipped: string[] = [];
  const linkInserts: { firm_id: string; client_id: string; linked_client_id: string; link_type: string }[] = [];

  for (const row of rows) {
    if (!row.linked_to_ref?.trim()) continue;
    const sourceRefKey = row.client_ref?.toUpperCase();
    if (!sourceRefKey) continue;
    const sourceId = existingRefToId.get(sourceRefKey);
    if (!sourceId) continue;

    const targetRefs = row.linked_to_ref.split(',').map(r => r.trim().toUpperCase()).filter(Boolean);
    for (const targetRef of targetRefs) {
      const targetId = existingRefToId.get(targetRef);
      if (!targetId) { linkSkipped.push(`Could not link ${row.client_ref} → ${targetRef} (not found)`); continue; }
      if (targetId === sourceId) continue;
      linkInserts.push({ firm_id: ctx.firmId, client_id: sourceId, linked_client_id: targetId, link_type: row.link_type ?? 'other' });
    }
  }

  if (linkInserts.length > 0) {
    const { error: linkError } = await supabase
      .from('client_links')
      .upsert(linkInserts, { ignoreDuplicates: true });
    if (linkError) {
      console.error('[clients/import] Bulk link error:', linkError);
      linkSkipped.push('Some links could not be created due to a database error');
    }
  }

  return NextResponse.json({ imported: imported.length, skipped, link_warnings: linkSkipped });
}
