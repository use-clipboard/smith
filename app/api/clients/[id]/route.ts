import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient, createServiceClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';

const CLIENT_TYPES = [
  'sole_trader', 'partnership', 'limited_company',
  'individual', 'trust', 'charity', 'rental_landlord',
] as const;

const UpdateClientSchema = z.object({
  name: z.string().min(1).optional(),
  client_ref: z.string().min(1).optional(),
  business_type: z.enum(CLIENT_TYPES).optional(),
  contact_email: z.string().email().optional().or(z.literal('')),
  risk_rating: z.enum(['Low', 'Medium', 'High']).optional().or(z.literal('')),
  is_active: z.boolean().optional(),
  // extended fields
  address: z.string().optional(),
  utr_number: z.string().optional(),
  registration_number: z.string().optional(),
  national_insurance_number: z.string().optional(),
  companies_house_id: z.string().optional(),
  vat_number: z.string().optional(),
  companies_house_auth_code: z.string().optional(),
  date_of_birth: z.string().optional(),
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
    .eq('client_id', params.id).order('created_at', { ascending: false }).limit(50);

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

  const { data: existing } = await supabase
    .from('clients').select('id').eq('id', params.id).eq('firm_id', ctx.firmId).single();
  if (!existing) return NextResponse.json({ error: 'Client not found' }, { status: 404 });

  const d = parsed.data;
  const updates: Record<string, unknown> = {};
  if (d.name !== undefined) updates.name = d.name;
  if (d.client_ref !== undefined) updates.client_ref = d.client_ref;
  if (d.business_type !== undefined) updates.business_type = d.business_type;
  if (d.contact_email !== undefined) updates.contact_email = d.contact_email || null;
  if (d.risk_rating !== undefined) updates.risk_rating = d.risk_rating || null;
  if (d.is_active !== undefined) updates.is_active = d.is_active;
  if (d.address !== undefined) updates.address = d.address || null;
  if (d.utr_number !== undefined) updates.utr_number = d.utr_number || null;
  if (d.registration_number !== undefined) updates.registration_number = d.registration_number || null;
  if (d.national_insurance_number !== undefined) updates.national_insurance_number = d.national_insurance_number || null;
  if (d.companies_house_id !== undefined) updates.companies_house_id = d.companies_house_id || null;
  if (d.vat_number !== undefined) updates.vat_number = d.vat_number || null;
  if (d.companies_house_auth_code !== undefined) updates.companies_house_auth_code = d.companies_house_auth_code || null;
  if (d.date_of_birth !== undefined) updates.date_of_birth = d.date_of_birth || null;

  const { data: client, error } = await supabase
    .from('clients').update(updates).eq('id', params.id).select().single();

  if (error) {
    console.error('PATCH /api/clients/[id]', error);
    return NextResponse.json({ error: 'Failed to update client' }, { status: 500 });
  }

  return NextResponse.json({ client });
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
