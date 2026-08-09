// Tax Studio — push a co-owner's share of JOINT interest into their own return.

import { listReturns, createReturn, saveReturn } from './persistence';
import { buildReturn } from './data';
import type { TaxedInterestItem, SavingsItem, CgtOwner, TaxReturn, ReturnTypeId } from './types';

let _iid = 0;
const iid = () => `ic-${Date.now()}-${_iid++}`;
const ownerPct = (owners: CgtOwner[] | undefined, ownerId: string) => ((owners?.find(o => o.id === ownerId)?.sharePct) || 0) / 100;

export interface InterestCoOwnerGroup {
  clientId: string;
  clientRef?: string;
  name: string;
  taxed: TaxedInterestItem[];   // the co-owner's share as sole (non-joint) items
  untaxed: SavingsItem[];
  totalShare: number;
}

/** Group the linked co-owners across joint interest items and build each one's
 *  share as ordinary (non-joint) interest entries for their own return. */
export function interestCoOwners(taxed: TaxedInterestItem[], untaxed: SavingsItem[]): InterestCoOwnerGroup[] {
  const map = new Map<string, InterestCoOwnerGroup>();
  const get = (o: CgtOwner) => {
    const g = map.get(o.clientId!) ?? { clientId: o.clientId!, clientRef: o.clientRef, name: o.name || 'Co-owner', taxed: [], untaxed: [], totalShare: 0 };
    if ((!g.name || g.name === 'Co-owner') && o.name) g.name = o.name;
    map.set(o.clientId!, g);
    return g;
  };
  for (const t of taxed) {
    for (const o of t.owners ?? []) {
      if (o.isTaxpayer || !o.clientId) continue;
      const f = ownerPct(t.owners, o.id);
      const net = Math.round((t.net || 0) * f), tax = Math.round((t.tax || 0) * f);
      const g = get(o); g.taxed.push({ id: iid(), description: t.description, net, tax }); g.totalShare += net + tax;
    }
  }
  for (const s of untaxed) {
    for (const o of s.owners ?? []) {
      if (o.isTaxpayer || !o.clientId) continue;
      const amt = Math.round((s.amount || 0) * ownerPct(s.owners, o.id));
      const g = get(o); g.untaxed.push({ id: iid(), description: s.description, amount: amt }); g.totalShare += amt;
    }
  }
  return [...map.values()];
}

/** The co-owner's SA return for the year (if any) + whether it already has interest. */
export async function findCoOwnerReturn(clientId: string, taxYear: string): Promise<{ ret: TaxReturn | null; hasInterest: boolean }> {
  const all = await listReturns();
  const item = all.find(x => x.ret.clientId === clientId && x.ret.taxYear === taxYear);
  if (!item) return { ret: null, hasInterest: false };
  const inc = item.ret.income;
  return { ret: item.ret, hasInterest: (inc.taxedInterestItems?.length ?? 0) > 0 || (inc.savingsInterestItems?.length ?? 0) > 0 };
}

/** Push a co-owner's interest share into their SA return for the year (create if none). */
export async function pushInterestToCoOwner(opts: {
  group: InterestCoOwnerGroup; taxYear: string; returnType: ReturnTypeId; existing: TaxReturn | null; mode: 'replace' | 'add';
}): Promise<{ created: boolean }> {
  const { group, taxYear, returnType, existing, mode } = opts;
  if (existing) {
    const prevT = existing.income.taxedInterestItems ?? [];
    const prevU = existing.income.savingsInterestItems ?? [];
    const updated: TaxReturn = {
      ...existing,
      income: {
        ...existing.income,
        taxedInterestItems: mode === 'replace' ? group.taxed : [...prevT, ...group.taxed],
        savingsInterestItems: mode === 'replace' ? group.untaxed : [...prevU, ...group.untaxed],
      },
      timeline: [...existing.timeline, { id: `t-${existing.timeline.length}`, at: new Date().toISOString(), kind: 'edited', label: `${mode === 'replace' ? 'Replaced' : 'Added'} the co-owner's share of joint interest into this return` }],
    };
    await saveReturn(updated);
    return { created: false };
  }
  const scaffold = buildReturn({ clientId: group.clientId, clientRef: group.clientRef ?? null, clientName: group.name, returnType, taxYear });
  scaffold.income = { ...scaffold.income, taxedInterestItems: group.taxed, savingsInterestItems: group.untaxed };
  await createReturn(scaffold);
  return { created: true };
}
