// SA101 — Additional information. One <SA101> for the return, from
// income.additional. Material boxes mapped (gilt interest, life-insurance gains,
// venture-capital & other reliefs, married-couple's allowance, losses, pension
// charges, avoidance-scheme refs). The itemised *Items breakdowns fold into the
// scalar box totals stored alongside them. ⚠ Element names PROVISIONAL pending
// the 2025/26 XSD; a few rare sub-boxes remain TODO.

import type { Sa101 } from '@/components/features/tax-studio/types';
import { el, flag, group, poundsDown, poundsUp } from '../xml';

export function buildSa101(sa: Sa101 | undefined): string {
  if (!sa) return '';
  return group('SA101', [
    // ── Other UK income ──
    el('GiltInterestNet', poundsDown(sa.giltInterestNet)),
    el('GiltTaxTaken', poundsUp(sa.giltTaxTaken)),
    el('GiltGross', poundsDown(sa.giltGross)),
    el('ChargeableEventGains', poundsDown(sa.chargeableEventGains)),
    el('ChargeableEventYears', sa.lifeGainTaxPaidYears),
    el('LifeGainNoTaxPaid', poundsDown(sa.lifeGainNoTaxPaid)),
    el('VoidedISAGain', poundsDown(sa.voidedIsaGain)),
    el('VoidedISATax', poundsUp(sa.voidedIsaTax)),
    el('DeficiencyRelief', poundsDown(sa.deficiencyRelief)),
    el('StockDividends', poundsDown(sa.stockDividends)),
    el('BonusIssues', poundsDown(sa.bonusIssues)),
    el('CloseCompanyLoansWrittenOff', poundsDown(sa.closeCompanyLoansWrittenOff)),
    el('BusinessReceiptsEarlierYear', poundsDown(sa.businessReceipts)),
    // ── Share schemes & lump sums ──
    el('ShareSchemesTaxable', poundsDown(sa.shareSchemesTaxable)),
    el('TaxableLumpSums', poundsDown(sa.taxableLumpSums)),
    el('RedundancyReceipts', poundsDown(sa.redundancyReceipts)),
    el('TaxTakenOffLumpSums', poundsUp(sa.taxOffLumpSums)),
    el('SeafarersDeduction', poundsUp(sa.seafarersDeduction)),
    el('PatentRoyaltyPayments', poundsDown(sa.patentRoyaltyPayments)),
    // ── Other tax reliefs (venture capital etc.) ──
    el('VCTSubscriptions', poundsDown(sa.vctSubscriptions)),
    el('EISSubscriptions', poundsDown(sa.eisSubscriptions)),
    el('SEISSubscriptions', poundsDown(sa.seisSubscriptions)),
    el('CITRInvestment', poundsDown(sa.citrInvestment)),
    el('AnnualPayments', poundsDown(sa.annualPayments)),
    el('QualifyingLoanInterest', poundsUp(sa.qualifyingLoanInterest)),
    el('PostCessationExpenses', poundsUp(sa.postCessationExpenses)),
    el('MaintenancePayments', poundsUp(sa.maintenancePayments)),
    el('TradeUnionDeathBenefits', poundsUp(sa.tradeUnionDeathBenefits)),
    // ── Married couple's allowance (born before 6 April 1935) ──
    el('MCASpouseName', sa.mcaSpouseName),
    flag('MCATransferHalf', sa.mcaTransferHalf),
    flag('MCATransferAll', sa.mcaTransferAll),
    flag('MCAReceiveHalf', sa.mcaReceiveHalf),
    flag('MCAReceiveAll', sa.mcaReceiveAll),
    flag('MCAHaveSurplus', sa.mcaHaveSurplus),
    flag('MCAGiveSurplus', sa.mcaGiveSurplus),
    // ── Income Tax losses ──
    el('EarlierYearsLosses', poundsDown(sa.earlierYearsLosses)),
    el('UnusedLossesCarriedForward', poundsDown(sa.unusedLossesCarriedForward)),
    el('LaterYearReliefClaimed', poundsDown(sa.laterYearReliefClaimed)),
    el('PayrollGiving', poundsDown(sa.payrollGiving)),
    // ── Pension savings tax charges ──
    el('AnnualAllowanceExcess', poundsDown(sa.annualAllowanceExcess)),
    el('AnnualAllowanceTaxPaid', poundsUp(sa.annualAllowanceTaxPaid)),
    el('PensionSchemeReference', sa.pensionSchemeRef),
    el('UnauthorisedPaymentNotSurcharge', poundsDown(sa.unauthNotSurcharge)),
    el('UnauthorisedPaymentSurcharge', poundsDown(sa.unauthSurcharge)),
    el('ForeignLumpSumTaxable', poundsDown(sa.foreignLumpTaxable)),
    // ── Tax avoidance schemes ──
    el('AvoidanceSchemeReferences', sa.avoidanceSchemeRefs),
    el('AvoidanceTaxYears', sa.avoidanceTaxYears),
  ]);
}
