// HMRC foreign-property "details" lifecycle (Property Business API v6.0).
//
// From TY 2026-27, the foreign cumulative period summary is keyed by a per-
// property HMRC `propertyId` (not countryCode). Those ids come from the foreign
// "details" endpoints on the client's single foreign-property business:
//   GET  /individuals/business/property/foreign/{nino}/{businessId}/details/{taxYear}
//        → { foreignPropertyDetails: [{ propertyId, propertyName, countryCode, … }] }
//   POST same path, body { propertyName, countryCode } → { propertyId }
//
// We resolve ids lazily at submit time: list existing, reuse a match by
// name+country, else create, then cache on mtd_it_properties.hmrc_property_id so
// we never re-create. Isolated here alongside the body builder.

import type { SupabaseClient } from '@supabase/supabase-js';
import { hmrcRequest, hmrcErrorMessage, type HmrcConnection } from '@/lib/hmrc/api';
import { resolveCountryCode } from './countryCodes';

interface HmrcForeignPropertyDetail { propertyId: string; propertyName?: string; countryCode?: string; endDate?: string }

/** A SMITH foreign property we need an HMRC propertyId for. */
export interface ForeignPropertyToResolve {
  id: string;                 // mtd_it_properties.id
  address: string;            // used as HMRC propertyName
  country: string | null;     // free text / code → resolved to alpha-3
  hmrcPropertyId: string | null; // already-cached id, if any
}

export interface ResolveForeignIdsResult {
  /** smith property id → HMRC propertyId, for every property we could resolve. */
  map: Map<string, string>;
  /** Properties we could NOT resolve (unresolvable country, or HMRC error). */
  errors: { id: string; address: string; reason: string }[];
}

function norm(s: string | null | undefined): string {
  return (s ?? '').trim().toLowerCase();
}

/**
 * Ensure each foreign property has an HMRC propertyId: reuse the cached one,
 * else match an existing HMRC property by name+country, else create one. Caches
 * the id back onto mtd_it_properties. Never creates a duplicate for a property
 * that already has (or can be matched to) an id.
 */
export async function ensureForeignPropertyIds(
  service: SupabaseClient,
  conn: HmrcConnection,
  nino: string,
  businessId: string,
  hmrcTaxYear: string,
  properties: ForeignPropertyToResolve[],
  fraudHeaders: Record<string, string>,
  testScenario: string | undefined,
): Promise<ResolveForeignIdsResult> {
  const map = new Map<string, string>();
  const errors: ResolveForeignIdsResult['errors'] = [];

  const detailsPath = `/individuals/business/property/foreign/${nino}/${businessId}/details/${hmrcTaxYear}`;

  // Which properties still need an id (skip already-cached).
  const need = properties.filter(p => {
    if (p.hmrcPropertyId) { map.set(p.id, p.hmrcPropertyId); return false; }
    return true;
  });
  if (need.length === 0) return { map, errors };

  // List existing HMRC foreign properties once so we can reuse matches.
  let existing: HmrcForeignPropertyDetail[] = [];
  const listRes = await hmrcRequest(conn, detailsPath, { version: '6.0', fraudHeaders, testScenario });
  if (listRes.status >= 200 && listRes.status < 300) {
    const j = listRes.json as { foreignPropertyDetails?: HmrcForeignPropertyDetail[] } | null;
    existing = (j?.foreignPropertyDetails ?? []).filter(d => d.propertyId && !d.endDate);
  } else if (listRes.status !== 404) {
    // A 404 (no properties yet) is fine — we'll create. Any other error blocks.
    for (const p of need) errors.push({ id: p.id, address: p.address, reason: hmrcErrorMessage(listRes.json) });
    return { map, errors };
  }

  for (const p of need) {
    const code = resolveCountryCode(p.country);
    if (!code) {
      errors.push({ id: p.id, address: p.address, reason: 'Set a country on this foreign property first.' });
      continue;
    }

    // Reuse an existing HMRC property with the same name + country.
    const match = existing.find(d => d.countryCode === code && norm(d.propertyName) === norm(p.address));
    let propertyId = match?.propertyId ?? null;

    // Otherwise create it.
    if (!propertyId) {
      const createRes = await hmrcRequest(conn, detailsPath, {
        method: 'POST', version: '6.0', fraudHeaders, testScenario,
        body: { propertyName: p.address.slice(0, 90) || `Foreign property (${code})`, countryCode: code },
      });
      if (createRes.status >= 200 && createRes.status < 300) {
        propertyId = (createRes.json as { propertyId?: string } | null)?.propertyId ?? null;
      }
      if (!propertyId) {
        errors.push({ id: p.id, address: p.address, reason: hmrcErrorMessage(createRes.json) });
        continue;
      }
      // Add to the in-memory list so two SMITH properties with the same
      // name+country don't create twice in one run.
      existing.push({ propertyId, propertyName: p.address, countryCode: code });
    }

    map.set(p.id, propertyId);
    // Cache the id (best-effort — the column may not be migrated yet; a failure
    // here just means we re-list/re-match next time, never a duplicate).
    try { await service.from('mtd_it_properties').update({ hmrc_property_id: propertyId }).eq('id', p.id); } catch { /* ignore */ }
  }

  return { map, errors };
}
