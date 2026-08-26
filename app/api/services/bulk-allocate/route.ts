import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getUserContext } from '@/lib/getUserContext';
import { createServiceClient } from '@/lib/supabase-server';

const Schema = z.object({
  catalogue_ids: z.array(z.string().uuid()).min(1),
  client_ids: z.array(z.string().uuid()).min(1),
});

interface AllocationResult {
  clientId: string;
  clientName: string;
  created: number;
  skipped: number;
  error?: string;
}

// POST /api/services/bulk-allocate — assign a set of SHARED catalogue services
// (proposal_services ids) to many clients at once. Admin only. Fee, frequency
// and VAT are copied from the catalogue; a service a client already has is
// skipped (never doubled). Mirrors the single-client `from-template` create.
export async function POST(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  if (ctx.userRole !== 'admin') return NextResponse.json({ error: 'Admin only' }, { status: 403 });

  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const parsed = Schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' }, { status: 400 });

  const service = createServiceClient();

  // Firm-scope both sides: only clients + catalogue services that belong to the
  // caller's firm are eligible, so a crafted id can't reach another firm's data.
  const { data: clients } = await service
    .from('clients').select('id, name')
    .in('id', parsed.data.client_ids).eq('firm_id', ctx.firmId);
  if (!clients || clients.length === 0) return NextResponse.json({ error: 'No matching clients.' }, { status: 404 });

  const { data: items } = await service
    .from('proposal_services').select('id, name, description, base_price, frequency, vat_treatment')
    .in('id', parsed.data.catalogue_ids).eq('firm_id', ctx.firmId).eq('active', true);
  if (!items || items.length === 0) return NextResponse.json({ error: 'No matching catalogue services.' }, { status: 404 });

  // Existing services + current max sort_order for every target client, in two
  // batched reads (not per-client round trips).
  const clientIds = clients.map(c => c.id);
  const { data: existing } = await service
    .from('client_services').select('client_id, catalogue_id, sort_order')
    .in('client_id', clientIds);

  const haveByClient = new Map<string, Set<string>>();
  const maxSortByClient = new Map<string, number>();
  for (const row of existing ?? []) {
    if (row.catalogue_id) {
      let set = haveByClient.get(row.client_id);
      if (!set) { set = new Set(); haveByClient.set(row.client_id, set); }
      set.add(row.catalogue_id);
    }
    const prev = maxSortByClient.get(row.client_id) ?? -1;
    if ((row.sort_order ?? -1) > prev) maxSortByClient.set(row.client_id, row.sort_order ?? -1);
  }

  const rows: Record<string, unknown>[] = [];
  const results: AllocationResult[] = [];
  for (const client of clients) {
    const have = haveByClient.get(client.id) ?? new Set<string>();
    let sort = maxSortByClient.get(client.id) ?? -1;
    let created = 0, skipped = 0;
    for (const i of items) {
      if (have.has(i.id)) { skipped++; continue; }
      rows.push({
        firm_id: ctx.firmId,
        client_id: client.id,
        catalogue_id: i.id,
        name: i.name,
        description: i.description ?? null,
        frequency: i.frequency ?? null,
        price_pence: i.base_price != null ? Math.round(Number(i.base_price) * 100) : null,
        vat_treatment: i.vat_treatment ?? null,
        status: 'active',
        created_by: ctx.userId,
        sort_order: ++sort,
      });
      created++;
    }
    results.push({ clientId: client.id, clientName: client.name, created, skipped });
  }

  if (rows.length > 0) {
    const { error } = await service.from('client_services').insert(rows);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const totalCreated = results.reduce((n, r) => n + r.created, 0);
  const totalSkipped = results.reduce((n, r) => n + r.skipped, 0);
  return NextResponse.json({ results, totalCreated, totalSkipped });
}
