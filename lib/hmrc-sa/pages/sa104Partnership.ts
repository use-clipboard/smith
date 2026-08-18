// SA104 — Partnership (this partner's share). One <SA104> per partnership.
// `form: 'short'` = SA104S (a subset). ⚠ Element names + SA104F/SA104S split are
// PROVISIONAL pending the 2025/26 XSD. box 8 = this partner's share of profit
// (from the Partnership Statement when present).

import type { PartnershipSource } from '@/components/features/tax-studio/types';
import { el, flag, group, isoDate, poundsDown, poundsUp } from '../xml';

function onePartnership(p: PartnershipSource): string {
  return group('SA104', [
    el('FormType', p.form === 'short' ? 'SA104S' : 'SA104F'),
    // Partnership details (boxes 1–4)
    el('PartnershipUTR', p.utr),
    el('PartnershipDescription', p.description),
    el('DateJoined', isoDate(p.dateJoined)),
    el('DateLeft', isoDate(p.dateLeft)),
    // Share of trading / professional profits (boxes 8–20.1)
    el('ShareOfProfit', poundsDown(p.profit > 0 ? p.profit : 0)),
    el('ShareOfLoss', poundsDown(p.profit < 0 ? -p.profit : 0)),
    el('PeriodAdjustment', poundsDown(p.adjustmentPeriod)),
    el('AveragingAdjustment', poundsDown(p.averagingAdjustment)),
    el('ForeignTaxDeduction', poundsUp(p.foreignTaxDeduction)),
    el('LossBroughtForward', poundsDown(p.lossBroughtForward)),
    el('OtherBusinessIncome', poundsDown(p.otherBusinessIncome)),
    el('FIGClaim', poundsDown(p.figClaim)),
    // Loss allocation (boxes 22–23)
    el('LossAgainstOtherIncome', poundsDown(p.lossAgainstOtherIncome)),
    el('LossCarriedBack', poundsDown(p.lossCarriedBack)),
    // NICs (boxes 25–27)
    flag('Class2Voluntary', p.class2Voluntary),
    flag('Class4Exempt', p.class4Exempt),
    el('Class4Adjustment', poundsDown(p.class4Adjustment)),
    // Untaxed savings income (boxes 28–35.1)
    el('ShareUKSavings', poundsDown(p.ukSavings)),
    el('ShareForeignSavings', poundsDown(p.foreignSavings)),
    el('ForeignTaxOnSavings', poundsUp(p.foreignSavingsTax)),
    // Income from UK property (boxes 36–41.2)
    el('SharePropertyProfit', poundsDown(p.propertyProfit)),
    el('PropertyLossBroughtForward', poundsDown(p.propertyLossBfwd)),
    el('PropertyFinanceCosts', poundsUp(p.propertyFinanceCosts)),
    // Other untaxed UK income (boxes 45–51)
    el('ShareOtherUKIncome', poundsDown(p.otherUkIncome)),
    // Offshore funds (boxes 52–55.1)
    el('ShareOffshoreIncome', poundsDown(p.offshoreIncome)),
    el('ForeignTaxOnOffshore', poundsUp(p.offshoreTax)),
    // Other untaxed foreign income (boxes 56–63.2)
    el('ShareForeignIncome', poundsDown(p.foreignIncome)),
    el('ForeignTaxOnForeignIncome', poundsUp(p.foreignTax)),
    // Partnership's taxed income (boxes 68–76.1)
    el('TaxedIncomeAt10', poundsDown(p.taxedIncome10)),
    el('TaxedIncomeAt20', poundsDown(p.taxedIncome20)),
    el('OtherTaxedIncome', poundsDown(p.otherTaxedIncome)),
    // Tax paid & deductions (boxes 77–79)
    el('IncomeTaxTaken', poundsUp(p.incomeTaxTaken)),
    el('CISDeductions', poundsUp(p.cisDeductions)),
    el('TaxOnTradingIncome', poundsUp(p.taxTakenTradingIncome)),
    el('OtherInformation', p.otherInformation),
  ]);
}

/** Build all SA104 pages (one per partnership). */
export function buildSa104(partnerships: PartnershipSource[] | undefined): string {
  return (partnerships ?? []).map(onePartnership).join('');
}
