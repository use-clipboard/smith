// SA103 full/short helpers — the turnover threshold that forces the full form,
// and the (shared-model) migrations between the two presentations.

import type { TradeSource } from './types';

/** VAT-registration threshold (2024/25+): at or above this turnover the full
 *  SA103F pages are required; below it the short SA103S may be used. */
export const SA103_SHORT_TURNOVER_LIMIT = 90000;

/** True when this trade's turnover requires the full form. */
export function tradeRequiresFull(t: TradeSource): boolean {
  return (t.turnover || 0) >= SA103_SHORT_TURNOVER_LIMIT;
}

/** Short → full: lossless — the short form is a slimmer view of the same data,
 *  so switching up just reveals the extra boxes. */
export function migrateTradeToFull(t: TradeSource): TradeSource {
  return { ...t, form: 'full' };
}

/** Full → short: lossy — short reports allowable expenses only and has no
 *  disallowables/balance-sheet/extra expense categories, so we net off the
 *  disallowable portions, fold the full-only expense & allowance boxes into the
 *  short equivalents, and drop what short can't hold. */
export function migrateTradeToShort(t: TradeSource): TradeSource {
  const n = (v?: number) => v || 0;
  const net = (gross?: number, dis?: number) => Math.max(0, n(gross) - n(dis));
  return {
    ...t,
    form: 'short',
    addressLine: undefined, // short has no first address line, only postcode
    // Allowable expenses (net of the disallowable portion); box 17 combines
    // interest + bank charges; box 19 "other" absorbs the full-only categories.
    expCostOfGoods: net(t.expCostOfGoods, t.disCostOfGoods),
    expCarVanTravel: net(t.expCarVanTravel, t.disCarVanTravel),
    expWages: net(t.expWages, t.disWages),
    expPremises: net(t.expPremises, t.disPremises),
    expRepairs: net(t.expRepairs, t.disRepairs),
    expProfessional: net(t.expProfessional, t.disProfessional),
    expInterest: net(t.expInterest, t.disInterest) + net(t.expBankCharges, t.disBankCharges),
    expOffice: net(t.expOffice, t.disOffice),
    expOtherCosts: net(t.expOtherCosts, t.disOtherCosts)
      + net(t.expSubcontractors, t.disSubcontractors)
      + net(t.expAdvertising, t.disAdvertising)
      + net(t.expBadDebts, t.disBadDebts)
      + net(t.expDepreciation, t.disDepreciation),
    // Capital allowances: box 25 "other" absorbs the full-only allowance boxes.
    ca6: n(t.ca6) + n(t.zeroEmissionGoods) + n(t.electricChargepoint) + n(t.enhancedCapitalAllowances) + n(t.allowancesOnSale),
    zeroEmissionGoods: undefined, electricChargepoint: undefined, enhancedCapitalAllowances: undefined, allowancesOnSale: undefined,
    // Folded-in / dropped fields.
    expBankCharges: undefined, expSubcontractors: undefined, expAdvertising: undefined, expBadDebts: undefined, expDepreciation: undefined,
    disCostOfGoods: undefined, disSubcontractors: undefined, disWages: undefined, disCarVanTravel: undefined, disPremises: undefined,
    disRepairs: undefined, disOffice: undefined, disAdvertising: undefined, disInterest: undefined, disBankCharges: undefined,
    disBadDebts: undefined, disProfessional: undefined, disDepreciation: undefined, disOtherCosts: undefined,
    incomeReceiptsElsewhere: undefined, basisAdjustment: undefined, changeOfPracticeAdjustment: undefined, averagingAdjustment: undefined,
    transitionProfitSpread: undefined, transitionLossBfwd: undefined, figClaim: undefined, adjustmentLossFig: undefined,
    // Balance sheet (short has none).
    bsEquipment: undefined, bsOtherFixedAssets: undefined, bsStock: undefined, bsDebtors: undefined, bsBank: undefined,
    bsCash: undefined, bsOtherCurrentAssets: undefined, bsCreditors: undefined, bsLoans: undefined, bsOtherLiabilities: undefined,
    caBalanceStart: undefined, caCapitalIntroduced: undefined, caDrawings: undefined,
  };
}
