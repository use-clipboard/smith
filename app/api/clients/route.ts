import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';

const CLIENT_TYPES = [
  'sole_trader', 'partnership', 'limited_company',
  'individual', 'trust', 'charity', 'rental_landlord',
] as const;

const CreateClientSchema = z.object({
  name: z.string().min(1, 'Client name is required'),
  client_ref: z.string().min(1, 'Client reference is required'),
  business_type: z.enum(CLIENT_TYPES).optional(),
  contact_email: z.string().email().optional().or(z.literal('')),
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

// GET /api/clients
export async function GET(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const supabase = createClient();
  const url = new URL(req.url);
  const search = url.searchParams.get('search') ?? '';
  const statusFilter = url.searchParams.get('status');
  const typeFilter = url.searchParams.get('type');
  const riskFilter = url.searchParams.get('risk');

  let query = supabase
    .from('clients')
    .select('id, name, client_ref, business_type, contact_email, risk_rating, is_active, created_at, address, utr_number, registration_number, national_insurance_number, companies_house_id, vat_number, companies_house_auth_code, date_of_birth')
    .eq('firm_id', ctx.firmId)
    .order('name', { ascending: true });

  if (search) query = query.or(`name.ilike.%${search}%,client_ref.ilike.%${search}%`);
  if (statusFilter === 'active') query = query.eq('is_active', true);
  if (statusFilter === 'inactive') query = query.eq('is_active', false);
  if (typeFilter) query = query.eq('business_type', typeFilter);
  if (riskFilter) query = query.eq('risk_rating', riskFilter);

  const { data: clients, error } = await query;
  if (error) {
    console.error('GET /api/clients', error);
    return NextResponse.json({ error: 'Failed to load clients' }, { status: 500 });
  }

  return NextResponse.json({ clients });
}

// POST /api/clients
export async function POST(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const parsed = CreateClientSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' }, { status: 400 });

  const { name, client_ref, business_type, contact_email, is_active,
    address, utr_number, registration_number, national_insurance_number,
    companies_house_id, vat_number, companies_house_auth_code, date_of_birth } = parsed.data;

  const supabase = createClient();

  const { data: existing } = await supabase
    .from('clients').select('id').eq('firm_id', ctx.firmId).eq('client_ref', client_ref).maybeSingle();
  if (existing) return NextResponse.json({ error: `Client reference "${client_ref}" already exists` }, { status: 409 });

  const { data: client, error } = await supabase
    .from('clients')
    .insert({
      firm_id: ctx.firmId, name, client_ref,
      business_type: business_type ?? null,
      contact_email: contact_email || null,
      is_active: is_active ?? true,
      address: address || null,
      utr_number: utr_number || null,
      registration_number: registration_number || null,
      national_insurance_number: national_insurance_number || null,
      companies_house_id: companies_house_id || null,
      vat_number: vat_number || null,
      companies_house_auth_code: companies_house_auth_code || null,
      date_of_birth: date_of_birth || null,
    })
    .select().single();

  if (error) {
    console.error('POST /api/clients', error);
    return NextResponse.json({ error: 'Failed to create client' }, { status: 500 });
  }

  return NextResponse.json({ client }, { status: 201 });
}
