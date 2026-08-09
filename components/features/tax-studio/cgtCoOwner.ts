// Tax Studio — push a co-owner's share of a jointly-owned disposal into THEIR
// own self-assessment return, so the same calculation isn't done twice.

import { listReturns, createReturn, saveReturn } from './persistence';
import { buildReturn } from './data';
import { cgtCalcToSa108, mergeCgtCalcForPush, cgtTaxpayerGain, sa108HasData } from './calc';
import type { CgtCalcDisposal, CgtCalcState, TaxReturn, ReturnTypeId } from './types';

let _cid = 0;
const cid = () => `co-${Date.now()}-${_cid++}`;

export interface CoOwnerGroup {
  clientId: string;
  clientRef?: string;
  name: string;
  /** The co-owner's versions of the shared disposals (them flagged as taxpayer). */
  disposals: CgtCalcDisposal[];
  /** Their total signed share gain / (loss). */
  shareGain: number;
}

/** A co-owner's version of a disposal — they become the taxpayer, the split kept.
 *  Reliefs and the residence facts carry over (a jointly-owned main home is the
 *  main home of both spouses); the accountant reviews on the co-owner's return. */
function disposalForCoOwner(d: CgtCalcDisposal, ownerId: string): CgtCalcDisposal {
  return { ...d, id: cid(), owners: (d.owners ?? []).map(o => ({ ...o, isTaxpayer: o.id === ownerId })) };
}

/** Group the linked co-owners (non-taxpayer owners with a clientId) across disposals. */
export function coOwnersFromDisposals(disposals: CgtCalcDisposal[]): CoOwnerGroup[] {
  const map = new Map<string, CoOwnerGroup>();
  for (const d of disposals) {
    for (const o of d.owners ?? []) {
      if (o.isTaxpayer || !o.clientId) continue;
      const cd = disposalForCoOwner(d, o.id);
      const g = map.get(o.clientId) ?? { clientId: o.clientId, clientRef: o.clientRef, name: o.name || 'Co-owner', disposals: [], shareGain: 0 };
      g.disposals.push(cd);
      g.shareGain += cgtTaxpayerGain(cd);
      if ((!g.name || g.name === 'Co-owner') && o.name) g.name = o.name;
      map.set(o.clientId, g);
    }
  }
  return [...map.values()];
}

/** The co-owner's existing SA return for the tax year (if any) + whether it
 *  already carries capital gains (so we can offer replace vs add-to). */
export async function findCoOwnerReturn(clientId: string, taxYear: string): Promise<{ ret: TaxReturn | null; hasCgt: boolean }> {
  const all = await listReturns();
  const item = all.find(x => x.ret.clientId === clientId && x.ret.taxYear === taxYear);
  if (!item) return { ret: null, hasCgt: false };
  const inc = item.ret.income;
  return { ret: item.ret, hasCgt: (inc.cgtCalc?.disposals?.length ?? 0) > 0 || sa108HasData(inc.sa108) };
}

/** Push a co-owner's disposals into their SA return for the year (create if none). */
export async function pushToCoOwnerReturn(opts: {
  group: CoOwnerGroup; taxYear: string; returnType: ReturnTypeId; existing: TaxReturn | null; mode: 'replace' | 'add';
}): Promise<{ created: boolean }> {
  const { group, taxYear, returnType, existing, mode } = opts;
  const scenarioCalc: CgtCalcState = { disposals: group.disposals };
  if (existing) {
    const merged = mergeCgtCalcForPush(existing.income.cgtCalc, scenarioCalc, mode);
    const updated: TaxReturn = {
      ...existing,
      income: { ...existing.income, cgtCalc: merged, sa108: cgtCalcToSa108(merged, existing.income.sa108) },
      timeline: [...existing.timeline, { id: `t-${existing.timeline.length}`, at: new Date().toISOString(), kind: 'edited', label: `${mode === 'replace' ? 'Replaced' : 'Added'} the co-owner's share of a jointly-owned disposal into this return` }],
    };
    await saveReturn(updated);
    return { created: false };
  }
  const scaffold = buildReturn({ clientId: group.clientId, clientRef: group.clientRef ?? null, clientName: group.name, returnType, taxYear });
  scaffold.income = { ...scaffold.income, cgtCalc: scenarioCalc, sa108: cgtCalcToSa108(scenarioCalc, undefined) };
  await createReturn(scaffold);
  return { created: true };
}
