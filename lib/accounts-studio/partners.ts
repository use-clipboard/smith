// Accounts Studio — partnership / LLP partner computations.
//
// Pure functions turning each partner's inputs + the year's net profit into the
// appropriation split and the capital & current-account reconciliations that
// feed the Appropriation Account, the partner schedules and the balance sheet.

import type { PartnerRecord } from '@/components/features/accounts-studio/types';

const r2 = (n: number) => +(Math.round(n * 100) / 100).toFixed(2);

export interface PartnerComputed extends PartnerRecord {
  closingCapital: number;   // opening + introduced − withdrawn
  residualShare: number;    // share of the residual profit (after interest + salaries)
  profitAllocated: number;  // interest on capital + salary + residual share
  closingCurrent: number;   // opening current + profit allocated − drawings
}

export interface PartnerTotals {
  interestOnCapital: number;
  salary: number;
  residual: number;
  profitAllocated: number;
  openingCapital: number;
  capitalIntroduced: number;
  capitalWithdrawn: number;
  closingCapital: number;
  openingCurrent: number;
  drawings: number;
  closingCurrent: number;
  partnersFunds: number;    // closing capital + closing current across all partners
}

export interface PartnerComputation {
  partners: PartnerComputed[];
  totals: PartnerTotals;
  netProfit: number;
}

/** Allocate the year's net profit across the partners and reconcile their
 *  capital and current accounts. Residual profit (after interest on capital and
 *  salaries) is split in the profit-share ratio. */
export function computePartners(partners: PartnerRecord[], netProfit: number): PartnerComputation {
  const totalInterest = partners.reduce((s, p) => s + (p.interestOnCapital || 0), 0);
  const totalSalary = partners.reduce((s, p) => s + (p.salary || 0), 0);
  const residual = netProfit - totalInterest - totalSalary;
  const shareTotal = partners.reduce((s, p) => s + (p.profitShare || 0), 0);

  const computed: PartnerComputed[] = partners.map(p => {
    const residualShare = shareTotal > 0 ? residual * ((p.profitShare || 0) / shareTotal) : 0;
    const profitAllocated = (p.interestOnCapital || 0) + (p.salary || 0) + residualShare;
    return {
      ...p,
      closingCapital: r2((p.openingCapital || 0) + (p.capitalIntroduced || 0) - (p.capitalWithdrawn || 0)),
      residualShare: r2(residualShare),
      profitAllocated: r2(profitAllocated),
      closingCurrent: r2((p.openingCurrent || 0) + profitAllocated - (p.drawings || 0)),
    };
  });

  const sum = (f: (p: PartnerComputed) => number) => r2(computed.reduce((s, p) => s + f(p), 0));
  const totals: PartnerTotals = {
    interestOnCapital: r2(totalInterest),
    salary: r2(totalSalary),
    residual: r2(residual),
    profitAllocated: sum(p => p.profitAllocated),
    openingCapital: sum(p => p.openingCapital || 0),
    capitalIntroduced: sum(p => p.capitalIntroduced || 0),
    capitalWithdrawn: sum(p => p.capitalWithdrawn || 0),
    closingCapital: sum(p => p.closingCapital),
    openingCurrent: sum(p => p.openingCurrent || 0),
    drawings: sum(p => p.drawings || 0),
    closingCurrent: sum(p => p.closingCurrent),
    partnersFunds: r2(sum(p => p.closingCapital) + sum(p => p.closingCurrent)),
  };

  return { partners: computed, totals, netProfit: r2(netProfit) };
}

/** A fresh, empty partner row. */
export function blankPartner(id: string): PartnerRecord {
  return { id, name: '', profitShare: 0, openingCapital: 0, capitalIntroduced: 0, capitalWithdrawn: 0, openingCurrent: 0, salary: 0, interestOnCapital: 0, drawings: 0 };
}

export function hasPartnerData(partners: PartnerRecord[] | null | undefined): boolean {
  return !!partners && partners.some(p => p.name.trim() || p.profitShare || p.openingCapital || p.openingCurrent || p.salary || p.interestOnCapital || p.drawings);
}
