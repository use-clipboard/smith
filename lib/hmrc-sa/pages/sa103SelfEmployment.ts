// SA103 — Self-employment. One <SA103> per trade. `form: 'short'` is the
// slimmer SA103S (turnover < VAT threshold); otherwise SA103F (full). The XSD
// distinguishes SA103F/SA103S — ⚠ confirm the element/root names + which boxes
// belong to each against the 2025/26 XSD (Phase 0). Element names PROVISIONAL.

import type { TradeSource } from '@/components/features/tax-studio/types';
import { el, flag, group, isoDate, poundsDown, poundsUp } from '../xml';

function oneTrade(t: TradeSource): string {
  const short = t.form === 'short';
  return group('SA103', [
    // Which form — a hint for the XSD root choice (confirm actual mechanism).
    el('FormType', short ? 'SA103S' : 'SA103F'),
    // Business details (boxes 1–10)
    el('BusinessName', t.name),
    el('BusinessDescription', t.description),
    el('BusinessAddress', t.addressLine),
    el('BusinessPostcode', t.postcode),
    flag('DetailsChanged', t.detailsChanged),
    flag('FosterCarer', t.fosterCarer),
    el('DateStarted', isoDate(t.dateStarted)),
    el('DateCeased', isoDate(t.dateCeased)),
    el('AccountingPeriodStart', isoDate(t.periodStart)),
    el('AccountingPeriodEnd', isoDate(t.periodEnd)),
    flag('CashBasis', t.traditionalAccounting === false),
    flag('SpecialArrangements', t.specialArrangements),
    // Business income (boxes 15–16.1)
    el('Turnover', poundsDown(t.turnover)),
    el('OtherBusinessIncome', poundsDown(t.otherBusinessIncome)),
    el('TradingIncomeAllowance', poundsUp(t.tradingIncomeAllowance)),
    // Allowable expenses (boxes 17–30)
    el('CostOfGoods', poundsUp(t.expCostOfGoods)),
    el('SubcontractorCosts', poundsUp(t.expSubcontractors)),
    el('StaffCosts', poundsUp(t.expWages)),
    el('CarVanTravel', poundsUp(t.expCarVanTravel)),
    el('PremisesCosts', poundsUp(t.expPremises)),
    el('RepairsRenewals', poundsUp(t.expRepairs)),
    el('OfficeCosts', poundsUp(t.expOffice)),
    el('AdvertisingCosts', poundsUp(t.expAdvertising)),
    el('InterestOnLoans', poundsUp(t.expInterest)),
    el('BankCharges', poundsUp(t.expBankCharges)),
    el('BadDebts', poundsUp(t.expBadDebts)),
    el('ProfessionalFees', poundsUp(t.expProfessional)),
    el('Depreciation', poundsUp(t.expDepreciation)),
    el('OtherExpenses', poundsUp(t.expOtherCosts)),
    // Capital allowances (boxes 49–59)
    el('AnnualInvestmentAllowance', poundsUp(t.aia)),
    el('CapitalAllowancesMainPool', poundsUp(t.ca18)),
    el('CapitalAllowancesSpecialRate', poundsUp(t.ca6)),
    el('ZeroEmissionGoodsAllowance', poundsUp(t.zeroEmissionGoods)),
    el('ZeroEmissionCarAllowance', poundsUp(t.zeroEmissionCar)),
    el('StructuresBuildingsAllowance', poundsUp(t.sba)),
    el('ElectricChargepointAllowance', poundsUp(t.electricChargepoint)),
    el('EnhancedCapitalAllowances', poundsUp(t.enhancedCapitalAllowances)),
    el('AllowancesOnSale', poundsDown(t.allowancesOnSale)),
    el('BalancingCharges', poundsDown(t.balancingCharges)),
    // Taxable profit / loss adjustments (boxes 60–76.1)
    el('GoodsForOwnUse', poundsDown(t.goodsOwnUse)),
    el('IncomeTaxableElsewhere', poundsDown(t.incomeReceiptsElsewhere)),
    el('BasisAdjustment', poundsDown(t.basisAdjustment)),
    el('ChangeOfPracticeAdjustment', poundsDown(t.changeOfPracticeAdjustment)),
    el('AveragingAdjustment', poundsDown(t.averagingAdjustment)),
    el('LossBroughtForward', poundsDown(t.lossBroughtForward)),
    el('FIGClaim', poundsDown(t.figClaim)),
    // Losses (boxes 77.1–79)
    el('LossSetOffOtherIncome', poundsDown(t.lossSetOffOtherIncome)),
    el('LossCarriedBack', poundsDown(t.lossCarriedBack)),
    el('UnusedLossCarriedForward', poundsDown(t.unusedLossCarriedForward)),
    // CIS & tax taken off (boxes 81–82)
    el('CISDeductions', poundsUp(t.cisDeductions)),
    el('OtherTaxTaken', poundsUp(t.otherTaxTaken)),
    // Net profit / loss (accounts figure — box 47/48)
    el('NetProfit', poundsDown(t.profit > 0 ? t.profit : 0)),
    el('NetLoss', poundsDown(t.profit < 0 ? -t.profit : 0)),
    // NIC & other information (boxes 100–103)
    flag('Class2Voluntary', t.class2Voluntary),
    flag('Class4Exempt', t.class4Exempt),
    el('Class4Adjustment', poundsDown(t.class4Adjustment)),
    el('OtherInformation', t.otherInformation),
  ]);
}

/** Build all SA103 pages (one per trade). Empty when there is no self-employment. */
export function buildSa103(trades: TradeSource[] | undefined): string {
  return (trades ?? []).map(oneTrade).join('');
}
