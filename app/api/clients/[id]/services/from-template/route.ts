import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getUserContext } from '@/lib/getUserContext';
import { createServiceClient } from '@/lib/supabase-server';

const Schema = z.object({ catalogue_ids: z.array(z.string().uuid()).min(1) });

// POST /api/clients/[id]/services/from-template — create client services in bulk
// from a set of SHARED catalogue services (proposal_services ids), e.g. a
// package/template. Admin only. Skips catalogue services the client already has.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  if (ctx.userRole !== 'admin') return NextResponse.json({ error: 'Admin only' }, { status: 403 });

  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const parsed = Schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' }, { status: 400 });

  const service = createServiceClient();
  const { data: client } = await service.from('clients').select('id').eq('id', params.id).eq('firm_id', ctx.firmId).single();
  if (!client) return NextResponse.json({ error: 'Client not found' }, { status: 404 });

  // Load the chosen catalogue services (firm-scoped, active).
  const { data: items } = await service
    .from('proposal_services').select('id, name, description, base_price, frequency, vat_treatment')
    .in('id', parsed.data.catalogue_ids).eq('firm_id', ctx.firmId).eq('active', true);
  if (!items || items.length === 0) return NextResponse.json({ created: 0 });

  // Skip catalogue services the client already has.
  const { data: have } = await service.from('client_services').select('catalogue_id').eq('client_id', params.id);
  const haveSet = new Set((have ?? []).map(r => r.catalogue_id).filter(Boolean));
  const { data: last } = await service
    .from('client_services').select('sort_order').eq('client_id', params.id).order('sort_order', { ascending: false }).limit(1).maybeSingle();
  let sort = (last?.sort_order ?? -1);

  const rows = items.filter(i => !haveSet.has(i.id)).map(i => ({
    firm_id: ctx.firmId,
    client_id: params.id,
    catalogue_id: i.id,
    name: i.name,
    description: i.description ?? null,
    frequency: i.frequency ?? null,
    price_pence: i.base_price != null ? Math.round(Number(i.base_price) * 100) : null,
    vat_treatment: i.vat_treatment ?? null,
    status: 'active',
    created_by: ctx.userId,
    sort_order: ++sort,
  }));
  if (rows.length === 0) return NextResponse.json({ created: 0 });

  const { error } = await service.from('client_services').insert(rows);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ created: rows.length });
}
