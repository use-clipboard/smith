import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createServiceClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';
import type { MtdItStreams } from '@/types';

// ── POST /api/mtd-it/agent/auto-map ──────────────────────────────────────────
// HMRC is the source of truth. For a client's discovered businesses we:
//   1. link each to an existing trade/property (by name, then unambiguous 1:1);
//   2. CREATE the income source if none exists (so streams reflect HMRC);
//   3. sync the client's mtd_it_streams to the resulting active sources;
//   4. flag (never delete) any local source HMRC didn't return.
const BUSINESS_ID = /^X[A-Z0-9]IS[0-9]{11}$/;

const Body = z.object({
  clientId: z.string().uuid(),
  businesses: z.array(z.object({
    typeOfBusiness: z.string(),
    businessId: z.string().regex(BUSINESS_ID),
    tradingName: z.string().nullish(),
  })),
});

type Type = 'self-employment' | 'uk-property' | 'foreign-property';
interface Source { id: string; name: string; hmrc_business_id: string | null }
const norm = (s: string | null | undefined) => (s ?? '').trim().toLowerCase();
const STREAM_OF: Record<Type, keyof MtdItStreams> = {
  'self-employment': 'sole', 'uk-property': 'uk_rental', 'foreign-property': 'foreign_rental',
};

export async function POST(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  let body: z.infer<typeof Body>;
  try { body = Body.parse(await req.json()); }
  catch (e) { return NextResponse.json({ error: 'Invalid payload', detail: String(e) }, { status: 400 }); }

  const service = createServiceClient();
  const { data: client } = await service
    .from('clients').select('id, mtd_it_streams').eq('id', body.clientId).eq('firm_id', ctx.firmId).single();
  if (!client) return NextResponse.json({ error: 'Client not found.' }, { status: 404 });

  const [{ data: trades }, { data: props }] = await Promise.all([
    service.from('mtd_it_trades').select('id, name, hmrc_business_id').eq('client_id', body.clientId).eq('active', true),
    service.from('mtd_it_properties').select('id, address, property_type, hmrc_business_id').eq('client_id', body.clientId).eq('active', true),
  ]);

  // Working pools per HMRC type (mutated as we link/create).
  const pools: Record<Type, Source[]> = {
    'self-employment': (trades ?? []).map(t => ({ id: t.id as string, name: t.name as string, hmrc_business_id: t.hmrc_business_id as string | null })),
    'uk-property': (props ?? []).filter(p => p.property_type === 'uk').map(p => ({ id: p.id as string, name: p.address as string, hmrc_business_id: p.hmrc_business_id as string | null })),
    'foreign-property': (props ?? []).filter(p => p.property_type === 'foreign').map(p => ({ id: p.id as string, name: p.address as string, hmrc_business_id: p.hmrc_business_id as string | null })),
  };

  const linked: { businessId: string; name: string; typeOfBusiness: string; via: 'name' | '1:1' }[] = [];
  const created: { businessId: string; name: string; typeOfBusiness: string }[] = [];
  const mismatches: { typeOfBusiness: string; name: string; reason: string }[] = [];

  const byType = new Map<Type, typeof body.businesses>();
  for (const b of body.businesses) {
    if (!STREAM_OF[b.typeOfBusiness as Type]) { mismatches.push({ typeOfBusiness: b.typeOfBusiness, name: b.businessId, reason: 'Unsupported business type.' }); continue; }
    byType.set(b.typeOfBusiness as Type, [...(byType.get(b.typeOfBusiness as Type) ?? []), b]);
  }

  for (const [type, list] of byType) {
    const sources = pools[type];
    const linkedIds = new Set(sources.filter(s => s.hmrc_business_id).map(s => s.hmrc_business_id));
    let freeSources = sources.filter(s => !s.hmrc_business_id);
    const freeBiz = list.filter(b => !linkedIds.has(b.businessId));

    async function link(sourceId: string, businessId: string, via: 'name' | '1:1', name: string) {
      const tbl = type === 'self-employment' ? 'mtd_it_trades' : 'mtd_it_properties';
      await service.from(tbl).update({ hmrc_business_id: businessId }).eq('id', sourceId).eq('client_id', body.clientId);
      linked.push({ businessId, name, typeOfBusiness: type, via });
    }

    // Pass 1 — exact trading-name match (self-employment).
    for (const b of [...freeBiz]) {
      if (!b.tradingName) continue;
      const m = freeSources.find(s => norm(s.name) === norm(b.tradingName));
      if (m) { await link(m.id, b.businessId, 'name', m.name); freeSources = freeSources.filter(s => s.id !== m.id); freeBiz.splice(freeBiz.indexOf(b), 1); }
    }
    // Pass 2 — greedy 1:1 onto any remaining unlinked source.
    while (freeBiz.length && freeSources.length) {
      const b = freeBiz.shift()!; const s = freeSources.shift()!;
      await link(s.id, b.businessId, '1:1', s.name);
    }
    // Pass 3 — CREATE a source for each remaining business (HMRC is truth).
    let n = sources.length;
    for (const b of freeBiz) {
      n += 1;
      if (type === 'self-employment') {
        const name = b.tradingName?.trim() || (sources.length === 0 && freeBiz.length === 1 ? 'Sole trade' : `Sole trade ${n}`);
        const { data: ins } = await service.from('mtd_it_trades').insert({ client_id: body.clientId, name, hmrc_business_id: b.businessId, active: true }).select('id').single();
        if (ins) created.push({ businessId: b.businessId, name, typeOfBusiness: type });
      } else {
        const isForeign = type === 'foreign-property';
        const address = `${isForeign ? 'Foreign property' : 'UK property'}${n > 1 ? ` ${n}` : ''}`;
        const { data: ins } = await service.from('mtd_it_properties').insert({ client_id: body.clientId, address, property_type: isForeign ? 'foreign' : 'uk', hmrc_business_id: b.businessId, active: true }).select('id').single();
        if (ins) created.push({ businessId: b.businessId, name: address, typeOfBusiness: type });
      }
    }
    // Leftover local sources HMRC didn't return — flag, don't touch.
    for (const s of freeSources) mismatches.push({ typeOfBusiness: type, name: s.name, reason: 'Local source not returned by HMRC — review.' });
  }

  // Sync streams to the income sources that now exist (existing active +
  // any we just created). Reflects HMRC rather than a manual guess.
  const createdTypes = new Set(created.map(c => c.typeOfBusiness as Type));
  const next: MtdItStreams = {
    sole:           pools['self-employment'].length > 0 || createdTypes.has('self-employment'),
    uk_rental:      pools['uk-property'].length > 0 || createdTypes.has('uk-property'),
    foreign_rental: pools['foreign-property'].length > 0 || createdTypes.has('foreign-property'),
  };
  const cur = (client.mtd_it_streams ?? {}) as Partial<MtdItStreams>;
  if (cur.sole !== next.sole || cur.uk_rental !== next.uk_rental || cur.foreign_rental !== next.foreign_rental) {
    await service.from('clients').update({ mtd_it_streams: next }).eq('id', body.clientId);
  }

  return NextResponse.json({ linked, created, mismatches, streams: next });
}
