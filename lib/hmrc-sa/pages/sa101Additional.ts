// SA101 — Additional information. One <SA101> for the return, built from
// income.additional (the Sa101 model). Element names, nesting and order are the
// real HMRC 2025/26 MTR schema (MTR-v1-2.xsd), not the earlier provisional
// guesses.
//
// Structure (in schema order):
//   SA101 → GiltEdgeSecuritiesInterest · LifeInsuranceGains
//         · StockDistributionsAndLoansWrittenOff · BusinessTaxedIncome
//         · SharesEmploymentCompensationsAndDeductions · OtherTaxReliefs
//         · AgeRelatedMarriedCouplesAllowance · OtherInformation
//
// Notes on the schema:
//   • BusinessTaxedIncome requires BOTH a receipt amount AND the tax year, so the
//     whole group is guarded on having both.
//   • AgeRelatedMarriedCouplesAllowance carries an xsd:choice between HigherEarner
//     (you transfer to your spouse) and LowerEarner (you receive) — only one is
//     rendered, each guarded on its required SpousesName (and, for LowerEarner,
//     the required half/all "transfer to you" flag).
//   • The itemised *Items breakdowns fold into the scalar box totals stored
//     alongside them, so only the scalars are emitted.

import type { Sa101 } from '@/components/features/tax-studio/types';
import { clip, digitsOnly, el, flag, group, isoDate, moneyDown, moneyUp } from '../xml';

/** MTR_SAtaxYearType — pattern [0-9]{4}-[0-9]{2} (e.g. "2024-25"). */
function taxYear(s: string | null | undefined): string | null {
  if (!s) return null;
  const t = String(s).trim();
  return /^[0-9]{4}-[0-9]{2}$/.test(t) ? t : null;
}

/** NumberOfYears — positiveInteger restricted to 1..99. */
function yearsCount(n: number | null | undefined): string | null {
  if (n == null || !Number.isFinite(n)) return null;
  const v = Math.trunc(n);
  return v >= 1 && v <= 99 ? String(v) : null;
}

export function buildSa101(sa: Sa101 | undefined): string {
  if (!sa) return '';

  // ── Interest from gilt-edged and other UK securities (boxes 1–3) ──────────
  const gilts = group('GiltEdgeSecuritiesInterest', [
    el('NetGiltInterest', moneyDown(sa.giltInterestNet)),
    el('TaxTakenOffGiltInterest', moneyUp(sa.giltTaxTaken)),
    el('GrossGiltInterest', moneyDown(sa.giltGross)),
  ]);

  // ── Life insurance gains (boxes 4–11) ─────────────────────────────────────
  const lifeGains = group('LifeInsuranceGains', [
    group('LifeInsuranceGainsTaxTreatedAsPaid', [
      el('AmountOfGain', moneyDown(sa.chargeableEventGains)),
      el('NumberOfYears', yearsCount(sa.lifeGainTaxPaidYears)),
    ]),
    group('LifeInsuranceGainsNoTaxTreatedAsPaid', [
      el('AmountOfGain', moneyDown(sa.lifeGainNoTaxPaid)),
      el('NumberOfYears', yearsCount(sa.lifeGainNoTaxYears)),
    ]),
    group('LifeInsuranceGainsFromVoidedISAs', [
      el('AmountOfGain', moneyDown(sa.voidedIsaGain)),
      el('NumberOfYears', yearsCount(sa.voidedIsaYears)),
    ]),
    el('TaxTakenOffGainsFromVoidedISAs', moneyUp(sa.voidedIsaTax)),
    el('DeficiencyRelief', moneyUp(sa.deficiencyRelief)),
  ]);

  // ── Stock dividends, bonus issues, close-company loans (boxes 12–13.1) ─────
  const stockDist = group('StockDistributionsAndLoansWrittenOff', [
    el('StockDividends', moneyDown(sa.stockDividends)),
    el('BonusIssuesOfSecuritiesAndRedeemableShares', moneyDown(sa.bonusIssues)),
    el('CloseCompanyLoansWrittenOffOrReleased', moneyDown(sa.closeCompanyLoansWrittenOff)),
  ]);

  // ── Business receipts taxed as income of an earlier year (boxes 14–15) ─────
  // Both children are required (1..1), so guard the group on having both.
  const btReceipts = moneyDown(sa.businessReceipts);
  const btYear = taxYear(sa.businessReceiptsYear);
  const businessTaxedIncome =
    btReceipts && btYear
      ? group('BusinessTaxedIncome', [
          el('PostCessationOrOtherBusinessReceipts', btReceipts),
          el('TaxYearIncomeToBeTaxed', btYear),
        ])
      : '';

  // ── Share schemes, lump sums, compensation & deductions (Ai 2) ─────────────
  const lumpSums = group('LumpSums', [
    el('LumpSumSalariesAndOtherPayments', moneyDown(sa.taxableLumpSums)),
    el('LumpSumsOrBenefitsFromRetirementSchemes', moneyDown(sa.efrbsBenefits)),
    el('RedundancyAndOtherCompensationPayments', moneyDown(sa.redundancyReceipts)),
    el('TaxTakenOff', moneyUp(sa.taxOffLumpSums)),
  ]);
  const sharesEtc = group('SharesEmploymentCompensationsAndDeductions', [
    el('ShareSchemesTaxableAmount', moneyDown(sa.shareSchemesTaxable)),
    lumpSums,
    flag('TaxTakenOffLumpSumsLeftBlank', sa.taxOnEmploymentPages),
    el('RetirementAndOtherExemptions', moneyUp(sa.exemptForeignService)),
    el('CompensationAndLumpSumExemption', moneyUp(sa.lumpSumExemption30k)),
    el('DisabilityAndForeignServiceDeduction', moneyUp(sa.disabilityPortion)),
    el('SeafarersEarningsDeduction', moneyUp(sa.seafarersDeduction)),
    el('NonUKTaxableForeignEarnings', moneyUp(sa.foreignEarningsNotTaxable)),
    el('ForeignTaxNoForeignTaxCreditReliefClaim', moneyUp(sa.foreignTaxNoTcr)),
    el('OverseasPensionExemptEmployerContributions', moneyUp(sa.exemptOverseasPensionContrib)),
    el('UKpatentRoyaltyPaymentsMade', moneyUp(sa.patentRoyaltyPayments)),
  ]);

  // ── Other tax reliefs (venture capital, loans, losses, maintenance …) ──────
  const otherReliefs = group('OtherTaxReliefs', [
    el('VentureCapitalTrustShareSubscriptions', moneyUp(sa.vctSubscriptions)),
    el('EnterpriseInvestmentSchemeShareSubscriptions', moneyUp(sa.eisSubscriptions)),
    el('CommunityInvestmentTrustRelief', moneyUp(sa.citrInvestment)),
    el('AnnuitiesAndAnnualPayments', moneyUp(sa.annualPayments)),
    el('QualifyingLoanInterest', moneyUp(sa.qualifyingLoanInterest)),
    el('PostCessationAndOtherLosses', moneyUp(sa.postCessationExpenses)),
    el('PreincorporationLosses', moneyUp(sa.preIncorporationLosses)),
    el('MaintenanceOrAlimonyPayments', moneyUp(sa.maintenancePayments)),
    el('TradeUnionEtcDeathBenefitPayments', moneyUp(sa.tradeUnionDeathBenefits)),
    el('BonusSecurityRedemptionDistributionRelief', moneyUp(sa.reliefRedemptionBonusShares)),
    el('SeedEnterpriseInvestmentSchemeAmount', moneyUp(sa.seisSubscriptions)),
    el('NondeductibleLoanInterest', moneyUp(sa.nonDeductiblePropertyPartnershipInterest)),
  ]);

  // ── Age-related married couple's allowance (choice: higher / lower earner) ─
  const higherName = clip(sa.mcaSpouseName, 28);
  const higherEarner = higherName
    ? group('HigherEarner', [
        el('SpousesName', higherName),
        el('SpousesDateOfBirth', isoDate(sa.mcaSpouseDob)),
        flag('HalfMinimumAllowanceTransferToOther', sa.mcaTransferHalf),
        flag('AllMinimumAllowanceTransferToOther', sa.mcaTransferAll),
        el('PreviousSpousesDateOfBirth', isoDate(sa.mcaPrevSpouseDob)),
      ])
    : '';
  const lowerName = clip(sa.mcaSpousePartnerFullName, 28);
  // LowerEarner's inner choice requires exactly one of the two flags.
  const lowerFlag = sa.mcaReceiveHalf
    ? flag('HalfMinimumAllowanceTransferToYou', true)
    : sa.mcaReceiveAll
      ? flag('AllMinimumAllowanceTransferToYou', true)
      : '';
  const lowerEarner =
    lowerName && lowerFlag ? group('LowerEarner', [lowerFlag, el('SpousesName', lowerName)]) : '';
  const earnerChoice = higherEarner || lowerEarner;
  const mca = group('AgeRelatedMarriedCouplesAllowance', [
    earnerChoice,
    el('DateOfMarriageOrCivilPartnership', isoDate(sa.mcaMarriageDate)),
    flag('SurplusAllowanceFromSpouse', sa.mcaHaveSurplus),
    flag('SurplusAllowanceToSpouse', sa.mcaGiveSurplus),
  ]);

  // ── Other information — losses, payroll giving, pension charges, avoidance ──
  const incomeTaxLosses = group('IncomeTaxLosses', [
    el('EarlierYearsIncomeTaxLosses', moneyUp(sa.earlierYearsLosses)),
    el('UnusedIncomeTaxLossesCarriedForward', moneyUp(sa.unusedLossesCarriedForward)),
    el('NextYearsTradingAndCapitalLossesRelief', moneyUp(sa.laterYearReliefClaimed)),
    el('NextYearsUncappedLossRelief', moneyUp(sa.laterYearReliefNotLimited)),
    el('YearForWhichReliefClaimed', taxYear(sa.laterYearLossTaxYear)),
  ]);
  const pensionTax = group('PensionTaxAndLumpSums', [
    el('AmountSavedExceedingAnnualAllowance', moneyDown(sa.annualAllowanceExcess)),
    el('AnnualAllowanceTaxPaidByPensionScheme', moneyUp(sa.annualAllowanceTaxPaid)),
    el('PensionBenefitTransferredSubjectToOTC', moneyDown(sa.pensionOverseasTransfer)),
    el('TaxPaidByPensionSchemeOnOTC', moneyUp(sa.overseasTransferChargeTax)),
    el('PensionSchemeTaxRef', clip(sa.pensionSchemeRef, 10)),
    el('UnauthorisedPaymentNotSubjectToSurcharge', moneyDown(sa.unauthNotSurcharge)),
    el('UnauthorisedPaymentSubjectToSurcharge', moneyDown(sa.unauthSurcharge)),
    el('ForeignTaxPaidOnUnauthorisedPayment', moneyUp(sa.unauthForeignTax)),
    el('OverseasPensionContributionShortServiceRefund', moneyDown(sa.foreignLumpShortServiceRefund)),
    el('ForeignTaxPaid', moneyUp(sa.foreignLumpForeignTax)),
  ]);
  // Tax avoidance schemes — up to 3 (line-per-scheme in the stored strings).
  const refLines = (sa.avoidanceSchemeRefs ?? '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  const yearLines = (sa.avoidanceTaxYears ?? '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  const avoidanceCount = Math.min(3, Math.max(refLines.length, yearLines.length));
  let avoidance = '';
  for (let i = 0; i < avoidanceCount; i++) {
    avoidance += group('TaxAvoidanceSchemes', [
      el('TaxAvoidanceSchemeReferenceNumber', digitsOnly(refLines[i], 8)),
      el('ExpectedAdvantageTaxYear', taxYear(yearLines[i])),
    ]);
  }
  const otherInformation = group('OtherInformation', [
    incomeTaxLosses,
    el('AmountOfPayrollGiving', moneyDown(sa.payrollGiving)),
    pensionTax,
    avoidance,
  ]);

  return group('SA101', [
    gilts,
    lifeGains,
    stockDist,
    businessTaxedIncome,
    sharesEtc,
    otherReliefs,
    mca,
    otherInformation,
  ]);
}
