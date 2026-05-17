import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient, createServiceClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';

// Co-owner links for a property.
//
// POST  /api/mtd-it/properties/[id]/links  { co_owner_client_id, co_owner_share_pct }
//   Creates the link FROM this property TO the co-owner. Also ensures the
//   co-owner has a matching property row (created if it doesn't exist) and
//   creates the REVERSE link so both clients see the relationship.
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

/** Normalised address used for the "same property" check when auto-linking. */
function normAddress(a: string): string {
  return a.replace(/\s+/g, ' ').trim().toLowerCase();
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

  if (co_owner_client_id === property.client_id) {
    return NextResponse.json({ error: 'Cannot link a property to its own client' }, { status: 400 });
  }

  const service = createServiceClient();

  // Verify co-owner is in the same firm + has the MTD IT flag on.
  const { data: coClient } = await service
    .from('clients')
    .select('id, firm_id, mtd_it')
    .eq('id', co_owner_client_id)
    .maybeSingle();
  if (!coClient || coClient.firm_id !== ctx.firmId) {
    return NextResponse.json({ error: 'Co-owner client not found in your firm' }, { status: 404 });
  }
  if (!coClient.mtd_it) {
    return NextResponse.json({ error: 'Co-owner must have the MTD IT flag on' }, { status: 400 });
  }

  // Find or create the co-owner's matching property record. Match is by
  // normalised address — case-insensitive, whitespace-collapsed.
  const wantedAddr = normAddress(property.address);
  const { data: existingCoProps } = await service
    .from('mtd_it_properties')
    .select('id, address, ownership_pct')
    .eq('client_id', co_owner_client_id);
  let coPropertyId = (existingCoProps ?? []).find(p => normAddress(p.address as string) === wantedAddr)?.id as string | undefined;

  if (!coPropertyId) {
    // Auto-create: same address/country/currency/type, ownership = co-owner's share.
    const { data: created, error: cErr } = await service
      .from('mtd_it_properties')
      .insert({
        client_id:     co_owner_client_id,
        address:       property.address,
        country:       property.country,
        currency:      property.currency,
        property_type: property.property_type,
        ownership_pct: co_owner_share_pct,
      })
      .select('id')
      .single();
    if (cErr || !created) {
      console.error('property links — auto-create co-owner property', cErr);
      return NextResponse.json({ error: 'Failed to create co-owner property' }, { status: 500 });
    }
    coPropertyId = created.id as string;
  }

  // Forward link (this property → co-owner, recording co-owner's share)
  const { error: fwdErr } = await service
    .from('mtd_it_property_links')
    .upsert({
      property_id:        property.id,
      co_owner_client_id,
      co_owner_share_pct,
      created_by:         ctx.userId,
    }, { onConflict: 'property_id,co_owner_client_id' });
  if (fwdErr) {
    console.error('property links — forward upsert', fwdErr);
    return NextResponse.json({ error: 'Failed to create link' }, { status: 500 });
  }

  // Reverse link (co-owner's property → this client, recording THIS client's
  // share — which is the property row's own ownership_pct).
  const { error: revErr } = await service
    .from('mtd_it_property_links')
    .upsert({
      property_id:        coPropertyId,
      co_owner_client_id: property.client_id,
      co_owner_share_pct: property.ownership_pct,
      created_by:         ctx.userId,
    }, { onConflict: 'property_id,co_owner_client_id' });
  if (revErr) {
    console.warn('property links — reverse upsert (forward link still saved)', revErr);
  }

  return NextResponse.json({ ok: true, co_property_id: coPropertyId });
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
