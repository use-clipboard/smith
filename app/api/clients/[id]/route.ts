import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient, createServiceClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';
import { applyClientStatusPolicy } from '@/lib/applyClientStatusPolicy';

const CLIENT_TYPES = [
  'sole_trader', 'partnership', 'limited_company', 'llp',
  'individual', 'trust', 'charity', 'rental_landlord',
] as const;

const UpdateClientSchema = z.object({
  name: z.string().min(1).optional(),
  client_ref: z.string().min(1).optional(),
  business_type: z.enum(CLIENT_TYPES).optional(),
  contact_email: z.string().email().optional().or(z.literal('')),
  risk_rating: z.enum(['Low', 'Medium', 'High']).optional().or(z.literal('')),
  status: z.enum(['active', 'hold', 'inactive']).optional(),
  // extended fields
  address: z.string().optional(),
  utr_number: z.string().optional(),
  registration_number: z.string().optional(),
  national_insurance_number: z.string().optional(),
  companies_house_id: z.string().optional(),
  vat_number: z.string().optional(),
  companies_house_auth_code: z.string().optional(),
  ch_idv_code: z.string().optional(),
  date_of_birth: z.string().optional(),
  // new extended fields
  contact_number: z.string().optional(),
  paye_reference: z.string().optional(),
  paye_accounts_office_reference: z.string().optional(),
  vat_submit_type: z.enum(['Cash', 'Accrual']).optional().or(z.literal('')),
  vat_scheme: z.enum(['Monthly', 'Quarterly', 'Yearly']).optional().or(z.literal('')),
  // Period-end month for the VAT scheme (1–12). For Quarterly, only 1–3
  // are valid (HMRC stagger groups). For Monthly, must be null. The PATCH
  // handler normalises this when the scheme is changed.
  vat_scheme_period_end_month: z.number().int().min(1).max(12).optional().nullable(),
  year_end: z.string().optional(),
  mtd_it: z.boolean().optional(),
  account_manager_id: z.string().uuid().nullable().optional(),
  key_contacts: z.array(z.object({
    name: z.string().min(1),
    role: z.string().optional().nullable(),
    email: z.string().optional().nullable(),
    phone: z.string().optional().nullable(),
    linked_client_id: z.string().uuid().optional().nullable(),
  })).optional(),
});

// GET /api/clients/[id]
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const supabase = createClient();

  const { data: client, error: clientError } = await supabase
    .from('clients').select('*').eq('id', params.id).eq('firm_id', ctx.firmId).single();

  if (clientError || !client) return NextResponse.json({ error: 'Client not found' }, { status: 404 });

  const serviceDb = createServiceClient();

  const { data: outputs } = await serviceDb
    .from('outputs').select('id, feature, target_software, created_at, user_id')
    .eq('client_id', params.id)
    // timeline_summary rows are an internal cache for the Timeline tab's AI
    // summary, not user-facing job outputs — keep them out of the Outputs list.
    .neq('feature', 'timeline_summary')
    .order('created_at', { ascending: false }).limit(50);

  const { data: documents } = await serviceDb
    .from('documents').select('id, file_name, document_type, created_at, drive_file_id')
    .eq('client_id', params.id).order('created_at', { ascending: false }).limit(100);

  return NextResponse.json({ client, outputs: outputs ?? [], documents: documents ?? [] });
}

// PATCH /api/clients/[id]
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const parsed = UpdateClientSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' }, { status: 400 });

  const supabase = createClient();

  // Pull current status too — we need it to detect a status transition so
  // we can fire the firm's task_client_status_policy side-effects below.
  const { data: existing } = await supabase
    .from('clients').select('id, status, business_type, registration_number').eq('id', params.id).eq('firm_id', ctx.firmId).single();
  if (!existing) return NextResponse.json({ error: 'Client not found' }, { status: 404 });
  const existingRow = existing as { status: 'active' | 'hold' | 'inactive' | null; business_type: string | null; registration_number: string | null };
  const previousStatus = existingRow.status ?? null;

  const d = parsed.data;
  const updates: Record<string, unknown> = {};
  if (d.name !== undefined) updates.name = d.name;
  if (d.client_ref !== undefined) updates.client_ref = d.client_ref;
  if (d.business_type !== undefined) updates.business_type = d.business_type;
  if (d.contact_email !== undefined) updates.contact_email = d.contact_email || null;
  if (d.risk_rating !== undefined) updates.risk_rating = d.risk_rating || null;
  if (d.status !== undefined) updates.status = d.status;
  if (d.account_manager_id !== undefined) updates.account_manager_id = d.account_manager_id || null;
  if (d.key_contacts !== undefined) updates.key_contacts = d.key_contacts;
  if (d.address !== undefined) updates.address = d.address || null;
  if (d.utr_number !== undefined) updates.utr_number = d.utr_number || null;
  if (d.registration_number !== undefined) updates.registration_number = d.registration_number || null;
  if (d.national_insurance_number !== undefined) updates.national_insurance_number = d.national_insurance_number || null;
  if (d.companies_house_id !== undefined) updates.companies_house_id = d.companies_house_id || null;
  if (d.vat_number !== undefined) updates.vat_number = d.vat_number || null;
  if (d.companies_house_auth_code !== undefined) updates.companies_house_auth_code = d.companies_house_auth_code || null;
  if (d.ch_idv_code !== undefined) updates.ch_idv_code = d.ch_idv_code || null;
  if (d.date_of_birth !== undefined) updates.date_of_birth = d.date_of_birth || null;
  if (d.contact_number !== undefined) updates.contact_number = d.contact_number || null;
  if (d.paye_reference !== undefined) updates.paye_reference = d.paye_reference || null;
  if (d.paye_accounts_office_reference !== undefined) updates.paye_accounts_office_reference = d.paye_accounts_office_reference || null;
  if (d.vat_submit_type !== undefined) updates.vat_submit_type = d.vat_submit_type || null;
  if (d.vat_scheme !== undefined) updates.vat_scheme = d.vat_scheme || null;
  // Period-end month: normalise based on the effective scheme so we never
  // store an invalid combo (e.g. month 7 with Quarterly, or any month with
  // Monthly). If the caller didn't supply scheme + month explicitly, fall
  // back to whichever side they did supply.
  if (d.vat_scheme_period_end_month !== undefined || d.vat_scheme !== undefined) {
    const effectiveScheme = d.vat_scheme !== undefined
      ? (d.vat_scheme || null)
      : undefined; // undefined here means "scheme unchanged — read from DB if needed"
    const proposedMonth = d.vat_scheme_period_end_month ?? null;

    if (effectiveScheme === 'Monthly') {
      updates.vat_scheme_period_end_month = null;
    } else if (effectiveScheme === 'Quarterly') {
      updates.vat_scheme_period_end_month =
        proposedMonth !== null && proposedMonth >= 1 && proposedMonth <= 3
          ? proposedMonth
          : null;
    } else if (effectiveScheme === 'Yearly') {
      updates.vat_scheme_period_end_month =
        proposedMonth !== null && proposedMonth >= 1 && proposedMonth <= 12
          ? proposedMonth
          : null;
    } else if (effectiveScheme === null) {
      // Scheme explicitly cleared — clear the month too.
      updates.vat_scheme_period_end_month = null;
    } else if (d.vat_scheme_period_end_month !== undefined) {
      // Scheme unchanged, just updating the month: trust the input range.
      updates.vat_scheme_period_end_month = proposedMonth;
    }
  }
  if (d.year_end !== undefined) updates.year_end = d.year_end || null;
  if (d.mtd_it !== undefined) updates.mtd_it = d.mtd_it;

  // Companies House ID is a background mirror of the company number
  // (registration_number) for limited companies and LLPs — the CH Secretarial
  // tool reads companies_house_id, but users only ever see/enter "Company
  // Number". Keep them identical so CH features work without a duplicate field.
  // Never surfaced in the UI.
  const effectiveType = d.business_type !== undefined ? d.business_type : existingRow.business_type;
  if (effectiveType === 'limited_company' || effectiveType === 'llp') {
    if (d.registration_number !== undefined) {
      // Company number is being set/changed → mirror it across.
      updates.companies_house_id = d.registration_number || null;
    } else if (d.business_type !== undefined) {
      // Type just switched to company/LLP without a number in the same
      // payload → mirror whatever registration number is already on record.
      updates.companies_house_id = existingRow.registration_number || null;
    }
  }

  const { data: client, error } = await supabase
    .from('clients').update(updates).eq('id', params.id).select().single();

  if (error) {
    console.error('PATCH /api/clients/[id]', error);
    return NextResponse.json({ error: 'Failed to update client' }, { status: 500 });
  }

  // ── Status-transition side-effects ────────────────────────────────────
  // If this PATCH flipped the client's status (active ↔ hold ↔ inactive),
  // apply the firm's task_client_status_policy. We use the service client
  // here so the cancel-open-tasks / break-CH-links writes bypass RLS the
  // same way the bulk and onboarding paths do. Failure is logged but
  // doesn't fail the underlying client update — the user can fix data
  // manually and still see their client update applied.
  const newStatus = (client as { status: 'active' | 'hold' | 'inactive' | null }).status ?? null;
  let policyApplied: Awaited<ReturnType<typeof applyClientStatusPolicy>> | null = null;
  if (newStatus && newStatus !== previousStatus) {
    try {
      const service = createServiceClient();
      policyApplied = await applyClientStatusPolicy(service, {
        firmId:        ctx.firmId,
        clientId:      params.id,
        previousStatus,
        newStatus,
        actorUserId:   ctx.userId,
      });
    } catch (err) {
      console.error('PATCH /api/clients/[id] — policy side-effect failed', err);
    }
  }

  return NextResponse.json({ client, policyApplied });
}

// DELETE /api/clients/[id]
export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const supabase = createClient();

  const { data: profile } = await supabase.from('users').select('role').eq('id', ctx.userId).single();
  if (profile?.role !== 'admin') return NextResponse.json({ error: 'Admin access required' }, { status: 403 });

  const { data: existing } = await supabase
    .from('clients').select('id').eq('id', params.id).eq('firm_id', ctx.firmId).single();
  if (!existing) return NextResponse.json({ error: 'Client not found' }, { status: 404 });

  const { error } = await supabase.from('clients').delete().eq('id', params.id);
  if (error) {
    console.error('DELETE /api/clients/[id]', error);
    return NextResponse.json({ error: 'Failed to delete client' }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
