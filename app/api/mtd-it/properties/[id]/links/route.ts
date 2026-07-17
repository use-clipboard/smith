import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient, createServiceClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';
import { linkCoOwner, normAddress } from '@/lib/mtdIt/propertyLinks';

// Co-owner links for a property.
//
// POST  /api/mtd-it/properties/[id]/links  { co_owner_client_id, co_owner_share_pct }
//   Creates the link FROM this property TO the co-owner. Also ensures the
//   co-owner has a matching property row (created if it doesn't exist) and
//   creates the REVERSE link so both clients see the relationship. The work
//   itself lives in lib/mtdIt/propertyLinks, shared with apply-to-all.
//
// DELETE /api/mtd-it/properties/[id]/links?co_owner_client_id=...
//   Removes both sides of the link. The auto-created property rows stay
//   (firm can keep or delete them manually) so we don't accidentally wipe
//   entries already attached to them.

const PostSchema = z.object({
  co_owner_client_id: z.string().uuid(),
  co_owner_share_pct: z.number().min(0.01).max(100),
});

/** Verify the property belongs to a client in the caller's firm. Returns
 *  the property row + the owning client's firm_id when so, else null. */
async function loadPropertyInFirm(propertyId: string, firmId: string) {
  const supabase = createClient();
  const { data } = await supabase
    .from('mtd_it_properties')
    .select('id, client_id, address, country, currency, property_type, ownership_pct, clients!inner(id, firm_id)')
    .eq('id', propertyId)
    .maybeSingle();
  if (!data) return null;
  const f = (data as unknown as { clients?: { firm_id?: string } }).clients?.firm_id;
  if (f !== firmId) return null;
  return data as unknown as { id: string; client_id: string; address: string; country: string | null; currency: string; property_type: 'uk' | 'foreign'; ownership_pct: number };
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const property = await loadPropertyInFirm(params.id, ctx.firmId);
  if (!property) return NextResponse.json({ error: 'Property not found' }, { status: 404 });

  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const parsed = PostSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' }, { status: 400 });
  const { co_owner_client_id, co_owner_share_pct } = parsed.data;

  const service = createServiceClient();
  const result = await linkCoOwner(service, {
    property,
    coOwnerClientId: co_owner_client_id,
    coOwnerSharePct: co_owner_share_pct,
    firmId: ctx.firmId,
    userId: ctx.userId,
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });

  return NextResponse.json({ ok: true, co_property_id: result.coPropertyId });
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const property = await loadPropertyInFirm(params.id, ctx.firmId);
  if (!property) return NextResponse.json({ error: 'Property not found' }, { status: 404 });

  const coClientId = new URL(req.url).searchParams.get('co_owner_client_id');
  if (!coClientId) return NextResponse.json({ error: 'co_owner_client_id required' }, { status: 400 });

  const service = createServiceClient();

  // Forward delete
  await service
    .from('mtd_it_property_links')
    .delete()
    .eq('property_id', property.id)
    .eq('co_owner_client_id', coClientId);

  // Reverse delete — find the co-owner's property by normalised address
  const wantedAddr = normAddress(property.address);
  const { data: coProps } = await service
    .from('mtd_it_properties')
    .select('id, address')
    .eq('client_id', coClientId);
  const coProp = (coProps ?? []).find(p => normAddress(p.address as string) === wantedAddr);
  if (coProp) {
    await service
      .from('mtd_it_property_links')
      .delete()
      .eq('property_id', coProp.id as string)
      .eq('co_owner_client_id', property.client_id);
  }

  return NextResponse.json({ ok: true });
}
