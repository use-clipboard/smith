import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';

const CLIENT_TYPES = [
  'sole_trader', 'partnership', 'limited_company', 'llp',
  'individual', 'trust', 'charity', 'rental_landlord',
] as const;

const CLIENT_STATUS = ['active', 'hold', 'inactive'] as const;

const CreateClientSchema = z.object({
  name: z.string().min(1, 'Client name is required'),
  client_ref: z.string().min(1, 'Client reference is required'),
  business_type: z.enum(CLIENT_TYPES).optional(),
  contact_email: z.string().email().optional().or(z.literal('')),
  status: z.enum(CLIENT_STATUS).optional(),
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
  // `types` (comma-separated) narrows to several business types at once — e.g.
  // individuals + sole traders for personal-asset co-ownership pickers.
  const typesFilter = (url.searchParams.get('types') ?? '').split(',').map(s => s.trim()).filter(Boolean);
  const riskFilter = url.searchParams.get('risk');

  const SELECT_COLS_BASE = 'id, name, client_ref, business_type, contact_email, contact_number, risk_rating, status, created_at, address, utr_number, registration_number, national_insurance_number, companies_house_id, vat_number, companies_house_auth_code, date_of_birth, paye_reference, paye_accounts_office_reference, vat_submit_type, vat_scheme, vat_scheme_period_end_month, year_end, mtd_it';
  // vat_rate_type + vat_flat_rate_percentage were added later (migration 20260787).
  // If that migration hasn't been applied yet the select 42703s — we drop them and
  // retry so client search never breaks on a lagging migration.
  const SELECT_COLS = `${SELECT_COLS_BASE}, vat_rate_type, vat_flat_rate_percentage`;
  let selectCols = SELECT_COLS;

  // ── Paginated fetch ───────────────────────────────────────────────────────
  // Supabase PostgREST has a server-level max_rows cap (default 1000) that
  // silently overrides any .limit() set in code. We work around it by fetching
  // in pages of 1000 and concatenating until we receive a partial page.
  const PAGE_SIZE = 1000;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let allClients: any[] = [];
  let offset = 0;

  while (true) {
    let q = supabase
      .from('clients')
      .select(selectCols)
      .eq('firm_id', ctx.firmId)
      .order('name', { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);

    if (search) q = q.or(`name.ilike.%${search}%,client_ref.ilike.%${search}%`);
    if (statusFilter === 'active' || statusFilter === 'hold' || statusFilter === 'inactive') q = q.eq('status', statusFilter);
    if (typeFilter) q = q.eq('business_type', typeFilter);
    if (typesFilter.length) q = q.in('business_type', typesFilter);
    if (riskFilter) q = q.eq('risk_rating', riskFilter);

    const { data, error } = await q;

    if (error) {
      // Undefined column (the newer VAT columns aren't migrated yet) → retry
      // this page without them rather than failing the whole client list.
      if (error.code === '42703' && selectCols !== SELECT_COLS_BASE) {
        selectCols = SELECT_COLS_BASE;
        continue;
      }
      console.error('GET /api/clients', error);
      return NextResponse.json({ error: 'Failed to load clients' }, { status: 500 });
    }

    if (!data || data.length === 0) break;
    allClients = allClients.concat(data);
    if (data.length < PAGE_SIZE) break; // partial page → we've reached the end
    offset += PAGE_SIZE;
  }

  return NextResponse.json({ clients: allClients, userRole: ctx.userRole });
}

// POST /api/clients
export async function POST(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const parsed = CreateClientSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' }, { status: 400 });

  const { name, client_ref, business_type, contact_email, status,
    address, utr_number, registration_number, national_insurance_number,
    companies_house_id, vat_number, companies_house_auth_code, ch_idv_code, date_of_birth } = parsed.data;

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
      status: status ?? 'active',
      address: address || null,
      utr_number: utr_number || null,
      registration_number: registration_number || null,
      national_insurance_number: national_insurance_number || null,
      // Companies House ID is a background mirror of the company number
      // (registration_number) for limited companies and LLPs. Users only ever
      // see/enter "Company Number"; the CH Secretarial tool reads
      // companies_house_id, so we keep them identical. Never surfaced in the UI.
      companies_house_id: (business_type === 'limited_company' || business_type === 'llp')
        ? (registration_number || null)
        : (companies_house_id || null),
      vat_number: vat_number || null,
      companies_house_auth_code: companies_house_auth_code || null,
      ch_idv_code: ch_idv_code || null,
      date_of_birth: date_of_birth || null,
    })
    .select().single();

  if (error) {
    console.error('POST /api/clients', error);
    return NextResponse.json({ error: 'Failed to create client' }, { status: 500 });
  }

  return NextResponse.json({ client }, { status: 201 });
}
