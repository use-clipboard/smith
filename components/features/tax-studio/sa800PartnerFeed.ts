// SA800 → SA104 partner feed.
//
// The filed/prepared SA800 Partnership Statement allocates each partner a share of
// the profit (box 8). This pushes that share into the partner's own SA100 return
// as an SA104 Partnership page — so the partnership is prepared once and each
// partner's personal return is fed from it. Mirrors the CGT/interest co-owner
// push (cgtCoOwner.ts). The pushed SA104 carries a stable id prefix per SA800
// return, so re-pushing updates the same line rather than duplicating it.

import type { TaxReturn, Sa800Data, PartnershipSource, Sa100Income } from './types';
import { listReturns, createReturn, saveReturn } from './persistence';
import { buildReturn } from './data';

const SA800_PFX = (sa800Id: string) => `sa800-${sa800Id}-`;

export interface PartnerPush {
  partnerId: string;
  clientId: string;
  name: string;
  share: number; // box 8 — share of profit/(loss)
}

/** The partner's existing SA100 return for the tax year (if any). */
export async function findPartnerReturn(clientId: string, taxYear: string): Promise<TaxReturn | null> {
  const all = await listReturns();
  return all.find(x => x.ret.clientId === clientId && x.ret.taxYear === taxYear && x.ret.returnType === 'sa100')?.ret ?? null;
}

/** Build the SA104 Partnership page for a partner's share of this SA800. */
function partnerSa104(sa800Ret: TaxReturn, share: number): PartnershipSource {
  const sa = sa800Ret.sa800 as Sa800Data;
  return {
    id: `${SA800_PFX(sa800Ret.id)}0`,
    name: sa.businessName || sa800Ret.clientName,
    form: 'short',
    utr: sa800Ret.utr ?? undefined,     // box 1 — partnership UTR
    description: sa.tradeDescription,    // box 2
    profit: Math.round(share),           // box 8 — share of profit
  };
}

function mergeSa104(income: Sa100Income, sa800Id: string, source: PartnershipSource): Sa100Income {
  const pfx = SA800_PFX(sa800Id);
  const partnerships = (income.partnerships ?? []).filter(x => !x.id.startsWith(pfx));
  partnerships.push(source);
  return { ...income, partnerships };
}

/** Push one partner's share into their SA100 (create the return if none exists). */
export async function pushPartnerShare(opts: {
  sa800Ret: TaxReturn; push: PartnerPush; existing: TaxReturn | null;
}): Promise<{ created: boolean }> {
  const { sa800Ret, push, existing } = opts;
  const source = partnerSa104(sa800Ret, push.share);
  const sa = sa800Ret.sa800 as Sa800Data;
  const label = `${source.profit < 0 ? 'Loss' : 'Profit'} share of ${sa.businessName || sa800Ret.clientName} (SA800) fed into this SA104`;

  if (existing) {
    const updated: TaxReturn = {
      ...existing,
      income: mergeSa104(existing.income, sa800Ret.id, source),
      timeline: [...existing.timeline, { id: `t-${existing.timeline.length}`, at: new Date().toISOString(), kind: 'edited', label }],
    };
    await saveReturn(updated);
    return { created: false };
  }

  const scaffold = buildReturn({ clientId: push.clientId, clientRef: null, clientName: push.name, returnType: 'sa100', taxYear: sa800Ret.taxYear });
  scaffold.income = mergeSa104(scaffold.income, sa800Ret.id, source);
  await createReturn(scaffold);
  return { created: true };
}
