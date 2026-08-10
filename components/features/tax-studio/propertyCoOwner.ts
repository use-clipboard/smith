// Tax Studio — push a co-owner's share of a jointly-owned UK property into THEIR
// own SA105, so a manually-entered joint property isn't keyed twice.

import { listReturns, createReturn, saveReturn } from './persistence';
import { buildReturn } from './data';
import { propertyTaxable } from './calc';
import type { PropertySource, CgtOwner, TaxReturn, ReturnTypeId } from './types';

let _pid = 0;
const pid = () => `pco-${Date.now()}-${_pid++}`;
const ownerPct = (owners: CgtOwner[] | undefined, ownerId: string) => ((owners?.find(o => o.id === ownerId)?.sharePct) || 0) / 100;

export interface PropertyCoOwnerGroup {
  clientId: string;
  clientRef?: string;
  name: string;
  /** The co-owner's share as ordinary (sole) property lines for their own SA105. */
  properties: PropertySource[];
  shareProfit: number;
}

/** A co-owner's share of a property as a plain sole-owned line. Uniform scaling of
 *  a property scales its taxable profit by the same fraction, so we carry their
 *  share of the taxable profit (+ residential finance costs) via the fallback. */
function propertyForCoOwner(p: PropertySource, ownerId: string): PropertySource {
  const f = ownerPct(p.owners, ownerId);
  return {
    id: pid(), address: p.address,
    profit: Math.round(propertyTaxable(p) * f),
    residentialFinanceCosts: (p.residentialFinanceCosts || 0) ? Math.round((p.residentialFinanceCosts || 0) * f) : undefined,
  };
}

/** Group the linked co-owners (non-taxpayer owners with a clientId) across the
 *  jointly-owned properties, with each one's share as their own property lines. */
export function propertyCoOwners(properties: PropertySource[]): PropertyCoOwnerGroup[] {
  const map = new Map<string, PropertyCoOwnerGroup>();
  for (const p of properties) {
    for (const o of p.owners ?? []) {
      if (o.isTaxpayer || !o.clientId) continue;
      const line = propertyForCoOwner(p, o.id);
      const g = map.get(o.clientId) ?? { clientId: o.clientId, clientRef: o.clientRef, name: o.name || 'Co-owner', properties: [], shareProfit: 0 };
      g.properties.push(line);
      g.shareProfit += line.profit || 0;
      if ((!g.name || g.name === 'Co-owner') && o.name) g.name = o.name;
      map.set(o.clientId, g);
    }
  }
  return [...map.values()];
}

/** The co-owner's SA return for the year (if any) + whether it already has property. */
export async function findCoOwnerReturn(clientId: string, taxYear: string): Promise<{ ret: TaxReturn | null; hasProperty: boolean }> {
  const all = await listReturns();
  const item = all.find(x => x.ret.clientId === clientId && x.ret.taxYear === taxYear);
  if (!item) return { ret: null, hasProperty: false };
  return { ret: item.ret, hasProperty: (item.ret.income.property?.length ?? 0) > 0 };
}

/** Push a co-owner's property share into their SA return for the year (create if none). */
export async function pushPropertyToCoOwner(opts: {
  group: PropertyCoOwnerGroup; taxYear: string; returnType: ReturnTypeId; existing: TaxReturn | null; mode: 'replace' | 'add';
}): Promise<{ created: boolean }> {
  const { group, taxYear, returnType, existing, mode } = opts;
  if (existing) {
    const prev = existing.income.property ?? [];
    const updated: TaxReturn = {
      ...existing,
      income: { ...existing.income, property: mode === 'replace' ? group.properties : [...prev, ...group.properties], propertyLetJointly: true },
      timeline: [...existing.timeline, { id: `t-${existing.timeline.length}`, at: new Date().toISOString(), kind: 'edited', label: `${mode === 'replace' ? 'Replaced' : 'Added'} the co-owner's share of a jointly-owned property into this return` }],
    };
    await saveReturn(updated);
    return { created: false };
  }
  const scaffold = buildReturn({ clientId: group.clientId, clientRef: group.clientRef ?? null, clientName: group.name, returnType, taxYear });
  scaffold.income = { ...scaffold.income, property: group.properties, propertyLetJointly: true };
  await createReturn(scaffold);
  return { created: true };
}
