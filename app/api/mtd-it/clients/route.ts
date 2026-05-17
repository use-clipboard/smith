import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';
import type { MtdItStreams, MtdItQuarterStatus } from '@/types';

const SELECT_COLS = [
  'id', 'name', 'client_ref', 'status', 'address',
  'utr_number', 'national_insurance_number', 'date_of_birth',
  'contact_email',
  'mtd_it', 'mtd_it_quarter_type', 'mtd_it_streams', 'mtd_it_prior_year_income',
  'mtd_it_notes',
].join(', ');

const DEFAULT_STREAMS: MtdItStreams = { sole: false, uk_rental: false, foreign_rental: false };

interface ClientRowDB {
  id: string;
  name: string;
  client_ref: string | null;
  status: 'active' | 'hold' | 'inactive' | null;
  address: string | null;
  utr_number: string | null;
  national_insurance_number: string | null;
  date_of_birth: string | null;
  contact_email: string | null;
  mtd_it: boolean | null;
  mtd_it_quarter_type: 'calendar' | 'standard' | null;
  mtd_it_streams: MtdItStreams | null;
  mtd_it_prior_year_income: number | null;
  mtd_it_notes: string | null;
}

interface QuarterRow {
  client_id: string;
  quarter: 1 | 2 | 3 | 4;
  status: MtdItQuarterStatus;
}

// GET /api/mtd-it/clients?tax_year=2026&search=...
export async function GET(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const supabase = createClient();
  const url = new URL(req.url);
  const search = url.searchParams.get('search') ?? '';
  const taxYearStr = url.searchParams.get('tax_year') ?? '2026';
  const taxYear = Math.max(2026, parseInt(taxYearStr, 10) || 2026);

  const PAGE_SIZE = 1000;
  let allClients: ClientRowDB[] = [];
  let offset = 0;

  while (true) {
    let q = supabase
      .from('clients')
      .select(SELECT_COLS)
      .eq('firm_id', ctx.firmId)
      .eq('mtd_it', true)
      .order('name', { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);

    if (search) q = q.or(`name.ilike.%${search}%,client_ref.ilike.%${search}%`);

    const { data, error } = await q;
    if (error) {
      console.error('GET /api/mtd-it/clients', error);
      return NextResponse.json({ error: 'Failed to load MTD IT clients' }, { status: 500 });
    }

    if (!data || data.length === 0) break;
    allClients = allClients.concat(data as unknown as ClientRowDB[]);
    if (data.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  // Fetch quarter statuses for the requested tax year in a single query
  const clientIds = allClients.map(c => c.id);
  let quarterRows: Array<QuarterRow & { id?: string }> = [];
  if (clientIds.length > 0) {
    const { data: qData, error: qErr } = await supabase
      .from('mtd_it_quarters')
      .select('id, client_id, quarter, status')
      .in('client_id', clientIds)
      .eq('tax_year', taxYear);
    if (qErr) {
      console.error('GET /api/mtd-it/clients quarters', qErr);
    } else if (qData) {
      quarterRows = qData as Array<QuarterRow & { id?: string }>;
    }
  }

  // Index quarter statuses by client → { 1?: status, 2?: status, ... }
  const quartersByClient = new Map<string, Partial<Record<1|2|3|4, MtdItQuarterStatus>>>();
  for (const row of quarterRows) {
    const existing = quartersByClient.get(row.client_id) ?? {};
    existing[row.quarter] = row.status;
    quartersByClient.set(row.client_id, existing);
  }

  // Look up which approved quarters have been edited since approval.
  // We pull active approval rows (approved_at non-null + voided_at null +
  // edited_since_approved_at non-null) and build a Map<quarter_id, true>
  // that the row component can use to render a warning chip.
  const quarterIds = quarterRows.map(r => r.id).filter((id): id is string => !!id);
  const editedAfterApproval = new Set<string>();
  if (quarterIds.length > 0) {
    const { data: approvals } = await supabase
      .from('mtd_it_quarter_approvals')
      .select('quarter_id')
      .in('quarter_id', quarterIds)
      .not('approved_at', 'is', null)
      .is('voided_at', null)
      .not('edited_since_approved_at', 'is', null);
    for (const a of (approvals ?? []) as Array<{ quarter_id: string }>) {
      editedAfterApproval.add(a.quarter_id);
    }
  }
  // Convert quarter_id → "{client_id}|{quarter_num}" mapping for the row payload.
  const editedFlags = new Map<string, Partial<Record<1|2|3|4, true>>>();
  for (const row of quarterRows) {
    if (!row.id || !editedAfterApproval.has(row.id)) continue;
    const m = editedFlags.get(row.client_id) ?? {};
    m[row.quarter] = true;
    editedFlags.set(row.client_id, m);
  }

  const clients = allClients.map(c => ({
    id: c.id,
    name: c.name,
    client_ref: c.client_ref,
    status: c.status ?? 'active',
    address: c.address,
    utr_number: c.utr_number,
    national_insurance_number: c.national_insurance_number,
    date_of_birth: c.date_of_birth,
    contact_email: c.contact_email,
    mtd_it_quarter_type: c.mtd_it_quarter_type ?? 'calendar',
    mtd_it_streams: (c.mtd_it_streams ?? DEFAULT_STREAMS) as MtdItStreams,
    mtd_it_prior_year_income: c.mtd_it_prior_year_income,
    mtd_it_notes: c.mtd_it_notes,
    quarters: quartersByClient.get(c.id) ?? {},
    quarters_edited_after_approval: editedFlags.get(c.id) ?? {},
  }));

  return NextResponse.json({ clients, tax_year: taxYear, user_role: ctx.userRole });
}

// POST /api/mtd-it/clients  { client_id }
//   Marks an existing client as an MTD IT client.
const AddClientSchema = z.object({ client_id: z.string().uuid() });

export async function POST(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const parsed = AddClientSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'Invalid input' }, { status: 400 });

  const supabase = createClient();
  const { data: existing } = await supabase
    .from('clients')
    .select('id, firm_id')
    .eq('id', parsed.data.client_id)
    .maybeSingle();

  if (!existing || existing.firm_id !== ctx.firmId) {
    return NextResponse.json({ error: 'Client not found' }, { status: 404 });
  }

  const { error } = await supabase
    .from('clients')
    .update({ mtd_it: true })
    .eq('id', parsed.data.client_id);

  if (error) {
    console.error('POST /api/mtd-it/clients', error);
    return NextResponse.json({ error: 'Failed to add client' }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

// DELETE /api/mtd-it/clients?client_id=...
//   Removes the MTD IT flag (does not delete the client record).
export async function DELETE(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const url = new URL(req.url);
  const clientId = url.searchParams.get('client_id');
  if (!clientId) return NextResponse.json({ error: 'client_id required' }, { status: 400 });

  const supabase = createClient();
  const { data: existing } = await supabase
    .from('clients').select('id, firm_id').eq('id', clientId).maybeSingle();
  if (!existing || existing.firm_id !== ctx.firmId) {
    return NextResponse.json({ error: 'Client not found' }, { status: 404 });
  }

  const { error } = await supabase
    .from('clients').update({ mtd_it: false }).eq('id', clientId);
  if (error) {
    console.error('DELETE /api/mtd-it/clients', error);
    return NextResponse.json({ error: 'Failed to remove client' }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
