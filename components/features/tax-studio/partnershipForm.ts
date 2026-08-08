// SA104 full ↔ short helpers. Unlike SA103, the partnership short form (SA104S)
// is a pure SUBSET view of the same data — it just hides the boxes the short
// form can't report (UK property, foreign, offshore, other UK income, untaxed
// savings and the taxed-income breakdown). So switching form is a lossless flag
// flip in both directions; the hidden figures are retained and reappear on flip
// back to full. The only guard is a warning when flipping full→short while those
// full-only streams hold data, since the short form must not be used then.

import type { PartnershipSource } from './types';

const nz = (x?: number) => x || 0;

/** True when this partner has income the SHORT form can't report — UK property,
 *  foreign, offshore, other untaxed UK income, untaxed savings or a taxed-income
 *  breakdown. Such a partner must file the full SA104F. */
export function partnershipRequiresFull(p: PartnershipSource): boolean {
  const streams = [
    p.propertyProfit, p.propertyAdjustment, p.propertyLossBfwd, p.propertyFinanceCosts,
    p.offshoreIncome, p.foreignIncome, p.foreignIncomeB, p.foreignTax,
    p.otherUkIncome, p.otherUkIncomeB,
    p.ukSavings, p.foreignSavings, p.savingsInterest,
    p.taxedIncome10, p.otherTaxedIncome,
    p.transitionProfit, p.transitionLossBfwd, p.figClaim,
    p.incomeTaxTaken,
  ];
  return streams.some(v => nz(v) > 0);
}

/** Present this partnership as the full SA104F (lossless — data is untouched). */
export function migratePartnershipToFull(p: PartnershipSource): PartnershipSource {
  return { ...p, form: 'full' };
}

/** Present this partnership as the short SA104S (lossless — full-only figures are
 *  retained on the record and simply hidden while in the short view). */
export function migratePartnershipToShort(p: PartnershipSource): PartnershipSource {
  return { ...p, form: 'short' };
}
