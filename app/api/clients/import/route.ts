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
  is_active: z.boolean().optional().default(true),
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
    .from('clients').select('id, client_ref').eq('firm_id', ctx.firmId);

  const existingRefToId = new Map<string, string>(
    (existingClients ?? []).map(c => [c.client_ref?.toUpperCase() ?? '', c.id])
  );

  const imported: string[] = [];
  const skipped: { name: string; reason: string }[] = [];

  for (const row of rows) {
    const refKey = row.client_ref?.toUpperCase();
    if (refKey && existingRefToId.has(refKey)) {
      skipped.push({ name: row.name, reason: `Client ref "${row.client_ref}" already exists` });
      continue;
    }

    const { data: created, error } = await supabase
      .from('clients')
      .insert({
        firm_id: ctx.firmId,
        name: row.name,
        client_ref: row.client_ref || null,
        business_type: row.business_type ?? null,
        contact_email: row.contact_email ?? null,
        is_active: row.is_active ?? true,
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
      })
      .select('id').single();

    if (error || !created) {
      skipped.push({ name: row.name, reason: 'Database error — please try again' });
      console.error('[clients/import] Insert error:', error);
    } else {
      imported.push(row.name);
      if (refKey) existingRefToId.set(refKey, created.id);
    }
  }

  // Process links
  const linkSkipped: string[] = [];
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

      const { error: linkError } = await supabase
        .from('client_links')
        .insert({ firm_id: ctx.firmId, client_id: sourceId, linked_client_id: targetId, link_type: row.link_type ?? 'other' })
        .select('id').single();

      if (linkError && linkError.code !== '23505') {
        linkSkipped.push(`Could not link ${row.client_ref} → ${targetRef}`);
        console.error('[clients/import] Link error:', linkError);
      }
    }
  }

  return NextResponse.json({ imported: imported.length, skipped, link_warnings: linkSkipped });
}
