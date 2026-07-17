// MTD IT — co-owner property links.
//
// Unlike the Landlord tool's `property_owners` (inert rows hanging off one
// property), an MTD IT co-owner link is a small graph:
//
//   A's property  --link(B, B's share)-->  B
//   B's property  --link(A, A's share)-->  A
//
// Adding a co-owner therefore does three things: find-or-create a matching
// property row on the CO-OWNER's own setup (matched by normalised address),
// write the forward link, and write the reverse link back. Both clients then
// see the relationship, and the co-owner-import can pair the two quarters up.
//
// This module exists so the single-link route and the apply-to-all route share
// one implementation — the reciprocal bookkeeping is easy to get subtly wrong,
// and two copies would drift.

import type { SupabaseClient } from '@supabase/supabase-js';

export interface LinkableProperty {
  id: string;
  client_id: string;
  address: string;
  country: string | null;
  currency: string;
  property_type: 'uk' | 'foreign';
  ownership_pct: number;
}

/** Normalised address used for the "same property" check when auto-linking.
 *  Case-insensitive and whitespace-collapsed, but deliberately nothing cleverer:
 *  fuzzy-matching two genuinely different addresses into one would produce a
 *  wrong filing. Mismatches are surfaced to the user instead (see the
 *  co-owner-import route's `issues`). */
export function normAddress(a: string): string {
  return a.replace(/\s+/g, ' ').trim().toLowerCase();
}

export type LinkResult =
  | { ok: true; coPropertyId: string }
  | { ok: false; error: string; status: number };

/**
 * Link `property` to `coOwnerClientId` at `coOwnerSharePct`, creating the
 * co-owner's property row and the reverse link as needed.
 *
 * Idempotent: both links are upserted on (property_id, co_owner_client_id), and
 * the co-owner's property is found by address before being created, so calling
 * this twice doesn't duplicate anything.
 *
 * Requires a SERVICE client — it writes rows belonging to another client.
 */
export async function linkCoOwner(
  service: SupabaseClient,
  opts: {
    property: LinkableProperty;
    coOwnerClientId: string;
    coOwnerSharePct: number;
    firmId: string;
    userId: string;
  },
): Promise<LinkResult> {
  const { property, coOwnerClientId, coOwnerSharePct, firmId, userId } = opts;

  if (coOwnerClientId === property.client_id) {
    return { ok: false, error: 'Cannot link a property to its own client', status: 400 };
  }

  // The co-owner must be in the same firm and actually be an MTD IT client —
  // we're about to create rows on their record.
  const { data: coClient } = await service
    .from('clients')
    .select('id, firm_id, mtd_it')
    .eq('id', coOwnerClientId)
    .maybeSingle();
  if (!coClient || coClient.firm_id !== firmId) {
    return { ok: false, error: 'Co-owner client not found in your firm', status: 404 };
  }
  if (!coClient.mtd_it) {
    return { ok: false, error: 'Co-owner must have the MTD IT flag on', status: 400 };
  }

  // Find or create the co-owner's matching property record.
  const wantedAddr = normAddress(property.address);
  const { data: existingCoProps } = await service
    .from('mtd_it_properties')
    .select('id, address')
    .eq('client_id', coOwnerClientId);
  let coPropertyId = (existingCoProps ?? []).find(p => normAddress(p.address as string) === wantedAddr)?.id as string | undefined;

  if (!coPropertyId) {
    const { data: created, error: cErr } = await service
      .from('mtd_it_properties')
      .insert({
        client_id:     coOwnerClientId,
        address:       property.address,
        country:       property.country,
        currency:      property.currency,
        property_type: property.property_type,
        ownership_pct: coOwnerSharePct,
      })
      .select('id')
      .single();
    if (cErr || !created) {
      console.error('property links — auto-create co-owner property', cErr);
      return { ok: false, error: 'Failed to create co-owner property', status: 500 };
    }
    coPropertyId = created.id as string;
  }

  // Forward link (this property → co-owner, recording the co-owner's share)
  const { error: fwdErr } = await service
    .from('mtd_it_property_links')
    .upsert({
      property_id:        property.id,
      co_owner_client_id: coOwnerClientId,
      co_owner_share_pct: coOwnerSharePct,
      created_by:         userId,
    }, { onConflict: 'property_id,co_owner_client_id' });
  if (fwdErr) {
    console.error('property links — forward upsert', fwdErr);
    return { ok: false, error: 'Failed to create link', status: 500 };
  }

  // Reverse link (co-owner's property → this client, recording THIS client's
  // share — which is the property row's own ownership_pct).
  const { error: revErr } = await service
    .from('mtd_it_property_links')
    .upsert({
      property_id:        coPropertyId,
      co_owner_client_id: property.client_id,
      co_owner_share_pct: property.ownership_pct,
      created_by:         userId,
    }, { onConflict: 'property_id,co_owner_client_id' });
  if (revErr) {
    console.warn('property links — reverse upsert (forward link still saved)', revErr);
  }

  return { ok: true, coPropertyId };
}

/**
 * Re-sync the reverse links that record THIS property's owner share.
 *
 * The reverse link snapshots `ownership_pct` at link time, so editing a
 * property's ownership afterwards used to leave every co-owner seeing the old
 * number. Call this whenever a property's ownership_pct changes.
 */
export async function syncReverseShares(
  service: SupabaseClient,
  property: Pick<LinkableProperty, 'id' | 'client_id' | 'address' | 'ownership_pct'>,
): Promise<void> {
  const { data: links } = await service
    .from('mtd_it_property_links')
    .select('co_owner_client_id')
    .eq('property_id', property.id);
  if (!links || links.length === 0) return;

  const wantedAddr = normAddress(property.address);
  for (const l of links) {
    const coClientId = l.co_owner_client_id as string;
    const { data: coProps } = await service
      .from('mtd_it_properties')
      .select('id, address')
      .eq('client_id', coClientId);
    const coProp = (coProps ?? []).find(p => normAddress(p.address as string) === wantedAddr);
    if (!coProp) continue; // addresses diverged — surfaced elsewhere, not ours to guess
    await service
      .from('mtd_it_property_links')
      .update({ co_owner_share_pct: property.ownership_pct })
      .eq('property_id', coProp.id as string)
      .eq('co_owner_client_id', property.client_id);
  }
}
