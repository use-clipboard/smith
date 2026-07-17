import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';
import { linkCoOwner, syncReverseShares, type LinkableProperty } from '@/lib/mtdIt/propertyLinks';

// Copy one property's ownership split to every other property of the same
// client. The common case is a portfolio held 50:50 by a couple — set it up
// once, apply it to the rest.
//
// GET  /api/mtd-it/properties/[id]/apply-to-all
//   Preview. Says how many properties would change and which already have a
//   DIFFERENT split that would be overwritten, so the confirm can name the
//   damage rather than asking "are you sure?" about nothing.
//
// POST /api/mtd-it/properties/[id]/apply-to-all
//   Apply. Sets each target's ownership_pct to the source's, then re-creates
//   the source's co-owner links on it.
//
// This can't be the set-based delete-and-reinsert the Landlord tool uses
// (app/api/landlord/property-owners/apply-to-all): MTD IT links are reciprocal
// and auto-create a property row on the co-owner's own setup, so each target
// has to go through the real link logic. One request in, a loop inside.

/** Only rentals of the same kind. Applying a UK split to a foreign property
 *  would be meaningless, and the two are filed as separate HMRC businesses. */
async function loadSource(propertyId: string, firmId: string) {
  const supabase = createClient();
  const { data } = await supabase
    .from('mtd_it_properties')
    .select('id, client_id, address, country, currency, property_type, ownership_pct, clients!inner(firm_id)')
    .eq('id', propertyId)
    .maybeSingle();
  if (!data) return null;
  const f = (data as unknown as { clients?: { firm_id?: string } }).clients?.firm_id;
  if (f !== firmId) return null;
  return data as unknown as LinkableProperty;
}

interface TargetPreview {
  id: string;
  address: string;
  /** Co-owner names currently on this property that the apply would replace. */
  conflictingOwners: string[];
}

async function planTargets(source: LinkableProperty) {
  const service = createServiceClient();

  const { data: targets } = await service
    .from('mtd_it_properties')
    .select('id, address, ownership_pct')
    .eq('client_id', source.client_id)
    .eq('property_type', source.property_type)
    .eq('active', true)
    .neq('id', source.id);

  const { data: sourceLinks } = await service
    .from('mtd_it_property_links')
    .select('co_owner_client_id, co_owner_share_pct')
    .eq('property_id', source.id);

  const sourceCoIds = new Set((sourceLinks ?? []).map(l => l.co_owner_client_id as string));

  // Which targets already carry a split that differs from the source's? Those
  // are the ones a user could lose work on, so they get named in the confirm.
  const targetIds = (targets ?? []).map(t => t.id as string);
  const { data: targetLinks } = targetIds.length
    ? await service
        .from('mtd_it_property_links')
        .select('property_id, co_owner_client_id')
        .in('property_id', targetIds)
    : { data: [] };

  const coIds = [...new Set([...sourceCoIds, ...(targetLinks ?? []).map(l => l.co_owner_client_id as string)])];
  const { data: coClients } = coIds.length
    ? await service.from('clients').select('id, name').in('id', coIds)
    : { data: [] };
  const nameById = new Map((coClients ?? []).map(c => [c.id as string, c.name as string]));

  const previews: TargetPreview[] = (targets ?? []).map(t => {
    const existing = (targetLinks ?? [])
      .filter(l => l.property_id === t.id)
      .map(l => l.co_owner_client_id as string);
    const differs =
      existing.length !== sourceCoIds.size || existing.some(id => !sourceCoIds.has(id));
    return {
      id: t.id as string,
      address: t.address as string,
      conflictingOwners: differs ? existing.map(id => nameById.get(id) ?? 'someone') : [],
    };
  });

  return { service, previews, sourceLinks: sourceLinks ?? [], sourceCoNames: [...sourceCoIds].map(id => nameById.get(id) ?? 'someone') };
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const source = await loadSource(params.id, ctx.firmId);
  if (!source) return NextResponse.json({ error: 'Property not found' }, { status: 404 });

  const { previews, sourceCoNames } = await planTargets(source);
  return NextResponse.json({
    target_count: previews.length,
    overwrites: previews.filter(p => p.conflictingOwners.length > 0)
      .map(p => ({ address: p.address, owners: p.conflictingOwners })),
    source_owner_names: sourceCoNames,
    source_ownership_pct: source.ownership_pct,
    property_type: source.property_type,
  });
}

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const source = await loadSource(params.id, ctx.firmId);
  if (!source) return NextResponse.json({ error: 'Property not found' }, { status: 404 });

  const { service, previews, sourceLinks } = await planTargets(source);
  if (previews.length === 0) return NextResponse.json({ ok: true, applied: 0 });

  const targetIds = previews.map(p => p.id);

  // Match the primary's share first, so the reverse links written below
  // snapshot the right number.
  const { error: pctErr } = await service
    .from('mtd_it_properties')
    .update({ ownership_pct: source.ownership_pct })
    .in('id', targetIds);
  if (pctErr) {
    console.error('apply-to-all — ownership_pct update', pctErr);
    return NextResponse.json({ error: 'Failed to apply the ownership share' }, { status: 500 });
  }

  // Drop co-owner links on the targets that aren't in the source's split. We
  // only remove the FORWARD link here and leave the co-owner's property row
  // alone — same reasoning as the DELETE handler in ../links: those rows may
  // already have entries attached, and wiping them would destroy real work.
  const keepIds = sourceLinks.map(l => l.co_owner_client_id as string);
  const stale = service
    .from('mtd_it_property_links')
    .delete()
    .in('property_id', targetIds);
  const { error: delErr } = keepIds.length
    ? await stale.not('co_owner_client_id', 'in', `(${keepIds.join(',')})`)
    : await stale;
  if (delErr) console.warn('apply-to-all — stale link cleanup', delErr);

  const failures: string[] = [];
  let applied = 0;
  for (const t of previews) {
    const target: LinkableProperty = { ...source, id: t.id, address: t.address, ownership_pct: source.ownership_pct };
    let ok = true;
    for (const l of sourceLinks) {
      const res = await linkCoOwner(service, {
        property: target,
        coOwnerClientId: l.co_owner_client_id as string,
        coOwnerSharePct: Number(l.co_owner_share_pct),
        firmId: ctx.firmId,
        userId: ctx.userId,
      });
      if (!res.ok) { ok = false; failures.push(`${t.address}: ${res.error}`); }
    }
    // Ownership changed above, so any link we kept is now carrying a stale
    // share on the co-owner's side.
    await syncReverseShares(service, { id: t.id, client_id: source.client_id, address: t.address, ownership_pct: source.ownership_pct });
    if (ok) applied++;
  }

  return NextResponse.json({
    ok: failures.length === 0,
    applied,
    // Partial application is possible (a co-owner without the MTD IT flag, say).
    // Report it rather than claiming success.
    failures: failures.slice(0, 5),
  });
}
