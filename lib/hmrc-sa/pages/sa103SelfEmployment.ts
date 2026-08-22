// SA103F — Self-employment (FULL). One <SA103F> per trade (schema allows 0..50).
//
// Validated against HMRC's 2025/26 MTR schema (MTR-v1-2.xsd). The full page is a
// valid superset of the short one, so every self-employment maps to SA103F.
// Element names, nesting and order below are the real schema names (the earlier
// "SA103" container and box names were provisional guesses).
//
// Required by the schema (always present on a rendered SA103F):
//   BusinessDetails                     (1..1)
//   BusinessDetails/BusinessName        (1..1, max 28)
//   BusinessDetails/BusinessDescription (1..1, max 42)
//   BusinessDetails/DidYourBusinessStart(1..1, yes/no)
//   BusinessDetails/DidYourBusinessCease(1..1, yes/no)

import type { TradeSource } from '@/components/features/tax-studio/types';
import { clip, el, flag, group, isoDate, moneyDown, moneyUp, yesno } from '../xml';

function oneTrade(t: TradeSource): string {
  // ── BusinessDetails (required; BusinessName + Description + the two yes/no
  //    start/cease questions are all mandatory children). ────────────────────
  const businessDetails = group('BusinessDetails', [
    el('BusinessName', clip(t.name, 28)),
    // BusinessDescription is required — fall back to a schema-valid placeholder
    // only so the return still validates; real data always carries a description.
    el('BusinessDescription', clip(t.description, 42) ?? 'Self-employment'),
    el('BusinessAddressFirstLine', clip(t.addressLine, 28)),
    el('BusinessAddressPostcode', clip(t.postcode, 9)),
    flag('ChangeOfBusinessDetails', t.detailsChanged),
    // Required yes/no — always render a definite value.
    yesno('DidYourBusinessStart', !!t.startedInYear),
    el('DateBusinessStarted', isoDate(t.dateStarted)),
    yesno('DidYourBusinessCease', !!t.ceasedInYear),
    el('DateBusinessCeased', isoDate(t.dateCeased)),
    el('DateAccountingPeriodStarts', isoDate(t.periodStart)),
    el('DateAccountingPeriodEnds', isoDate(t.periodEnd)),
    // Cash basis is the default; the box is an election to OPT OUT (i.e. use
    // traditional/accruals accounting).
    flag('ElectionToOptOutOfCashBasis', t.traditionalAccounting === true),
  ]);

  // ── OtherInformation ──────────────────────────────────────────────────────
  const otherInformation = group('OtherInformation', [
    flag('SpecialArrangementsApply', t.specialArrangements),
    flag('InformationProvidedLastYear', t.priorYearProfitDetails),
  ]);

  // ── BusinessIncome ────────────────────────────────────────────────────────
  const businessIncome = group('BusinessIncome', [
    el('Turnover', moneyDown(t.turnover)),
    el('OtherBusinessIncome', moneyDown(t.otherBusinessIncome)),
    el('TradingIncomeAllowance', moneyUp(t.tradingIncomeAllowance)),
  ]);

  // ── BusinessExpenses → TotalExpenses + DisallowableExpenses ───────────────
  const totalExpenses = group('TotalExpenses', [
    el('CostOfGoods', moneyUp(t.expCostOfGoods)),
    el('SubcontractorCosts', moneyUp(t.expSubcontractors)),
    el('WagesSalariesAndStaffCosts', moneyUp(t.expWages)),
    el('CarVanAndTravelExpenses', moneyUp(t.expCarVanTravel)),
    el('RentAndOtherPropertyCosts', moneyUp(t.expPremises)),
    el('RepairsAndMaintenanceCosts', moneyUp(t.expRepairs)),
    el('PhoneAndOtherOfficeCosts', moneyUp(t.expOffice)),
    el('AdvertisingAndEntertainmentCosts', moneyUp(t.expAdvertising)),
    el('BankAndLoanInterest', moneyUp(t.expInterest)),
    el('OtherFinanceCharges', moneyUp(t.expBankCharges)),
    el('DebtsWrittenOff', moneyUp(t.expBadDebts)),
    el('AccountancyAndLegalFees', moneyUp(t.expProfessional)),
    el('DepreciationAndLossProfitOnSale', moneyUp(t.expDepreciation)),
    el('OtherBusinessExpenses', moneyUp(t.expOtherCosts)),
  ]);
  const disallowableExpenses = group('DisallowableExpenses', [
    el('DisallowableCostOfGoods', moneyUp(t.disCostOfGoods)),
    el('DisallowableSubcontractorCosts', moneyUp(t.disSubcontractors)),
    el('DisallowableStaffCosts', moneyUp(t.disWages)),
    el('DisallowableCarAndTravelExpenses', moneyUp(t.disCarVanTravel)),
    el('DisallowableRentAndOtherPropertyCosts', moneyUp(t.disPremises)),
    el('DisallowableRepairsAndMaintenanceCosts', moneyUp(t.disRepairs)),
    el('DisallowablePhoneAndOtherOfficeCosts', moneyUp(t.disOffice)),
    el('DisallowableAdvertisingAndEntertainmentCosts', moneyUp(t.disAdvertising)),
    el('DisallowableBankAndLoanInterest', moneyUp(t.disInterest)),
    el('DisallowableOtherFinanceCharges', moneyUp(t.disBankCharges)),
    el('DisallowableDebtsWrittenOff', moneyUp(t.disBadDebts)),
    el('DisallowableAccountancyAndLegalFees', moneyUp(t.disProfessional)),
    el('DisallowableDepreciationAndLossProfitOnSale', moneyUp(t.disDepreciation)),
    el('DisallowableOtherBusinessExpenses', moneyUp(t.disOtherCosts)),
  ]);
  const businessExpenses = group('BusinessExpenses', [totalExpenses, disallowableExpenses]);

  // ── NetProfitLoss (accounts net profit / (loss); signed) ──────────────────
  const netProfitLoss = el('NetProfitLoss', moneyDown(t.profit));

  // ── CapitalAllowances ─────────────────────────────────────────────────────
  const capitalAllowances = group('CapitalAllowances', [
    el('AnnualInvestmentAllowance', moneyUp(t.aia)),
    el('AnnualAllowancesAtHigherRate', moneyUp(t.ca18)),   // 18% main pool
    el('AnnualAllowancesAtLowerRate', moneyUp(t.ca6)),     // 6% special rate
    el('ZeroEmissionGoodsVehicleAllowance', moneyUp(t.zeroEmissionGoods)),
    el('ZeroEmissionCarAllowance', moneyUp(t.zeroEmissionCar)),
    el('TheStructuresAndBuildingsAllowance', moneyUp(t.sba)),
    el('FreeportAndInvestmentZonesStructuresAndBuildingsAllowance', moneyUp(t.sbaFreeport)),
    el('ElectricChargePointAllowance', moneyUp(t.electricChargepoint)),
    el('OtherCapitalAllowances', moneyUp(t.enhancedCapitalAllowances)),
    el('BalancingAllowancesOnSaleOrCessation', moneyUp(t.allowancesOnSale)),
    el('TotalBalancingCharges', moneyDown(t.balancingCharges)),
  ]);

  // ── TaxableProfitOrLoss (adjustments) ─────────────────────────────────────
  const taxableProfitOrLoss = group('TaxableProfitOrLoss', [
    el('OwnGoodsAndServices', moneyDown(t.goodsOwnUse)),
    el('NonTaxableBusinessIncome', moneyDown(t.incomeReceiptsElsewhere)),
    el('TaxYearAdjustment', moneyDown(t.basisAdjustment)),
    el('ChangeOfAccountingPracticeAdjustment', moneyDown(t.changeOfPracticeAdjustment)),
    el('AveragingAdjustment', moneyDown(t.averagingAdjustment)),
    el('SpreadTransitionProfitTreatedAsArising', moneyDown(t.transitionProfitSpread)),
    el('LossBroughtForwardUsedAgainstSpreadTransitionProfit', moneyUp(t.transitionLossBfwd)),
    el('LossBroughtForward', moneyUp(t.lossBroughtForward)),
    el('AnyOtherBusinessIncome', moneyDown(t.otherBusinessIncome75)),
    el('TotalTaxableBusinessProfitsFIGclaim', moneyDown(t.figClaim)),
  ]);

  // ── Losses ────────────────────────────────────────────────────────────────
  const losses = group('Losses', [
    el('AdjustedLossForTheYearFIGclaim', moneyUp(t.adjustmentLossFig)),
    el('LossOfYearSetAgainstOtherIncome', moneyUp(t.lossSetOffOtherIncome)),
    el('LossToCarryBack', moneyUp(t.lossCarriedBack)),
    el('TotalLossToCarryForward', moneyUp(t.unusedLossCarriedForward)),
  ]);

  // ── TaxTakenOff ───────────────────────────────────────────────────────────
  const taxTakenOff = group('TaxTakenOff', [
    el('SubContractorsTaxDeduction', moneyUp(t.cisDeductions)),
    el('OtherTaxTakenOffTradingIncome', moneyUp(t.otherTaxTaken)),
  ]);

  // ── BalanceSheet ──────────────────────────────────────────────────────────
  const assets = group('Assets', [
    el('EquipmentMachineryVehicles', moneyDown(t.bsEquipment)),
    el('OtherFixedAssets', moneyDown(t.bsOtherFixedAssets)),
    el('StockAndWorkInProgress', moneyDown(t.bsStock)),
    el('TradeDebtors', moneyDown(t.bsDebtors)),
    el('BankEtcBalances', moneyDown(t.bsBank)),
    el('CashInHand', moneyDown(t.bsCash)),
    el('OtherCurrentAssets', moneyDown(t.bsOtherCurrentAssets)),
  ]);
  const liabilities = group('Liabilities', [
    el('TradeCreditors', moneyDown(t.bsCreditors)),
    el('LoansAndOverdrafts', moneyDown(t.bsLoans)),
    el('OtherLiabilities', moneyDown(t.bsOtherLiabilities)),
  ]);
  const capitalAccount = group('CapitalAccount', [
    el('CapitalAccountBalanceAtStart', moneyDown(t.caBalanceStart)),
    el('NetProfitOrLoss', moneyDown(t.profit)),
    el('CapitalIntroduced', moneyDown(t.caCapitalIntroduced)),
    el('Drawings', moneyUp(t.caDrawings)),
  ]);
  const balanceSheet = group('BalanceSheet', [assets, liabilities, capitalAccount]);

  // ── NICs — Class4NICexempt vs AdjustmentToClass4NICProfits is an xsd:choice,
  //    so render at most one of them. ─────────────────────────────────────────
  const class4Choice = t.class4Exempt
    ? flag('Class4NICexempt', true)
    : el('AdjustmentToClass4NICProfits', moneyDown(t.class4Adjustment));
  const nics = group('NICs', [
    flag('PayClass2NICvoluntarily', t.class2Voluntary),
    class4Choice,
  ]);

  // ── OtherInformationSpace (free text, max 20480) ──────────────────────────
  const otherInformationSpace = el('OtherInformationSpace', clip(t.otherInformation, 20480));

  return group('SA103F', [
    businessDetails,
    otherInformation,
    businessIncome,
    businessExpenses,
    netProfitLoss,
    capitalAllowances,
    taxableProfitOrLoss,
    losses,
    taxTakenOff,
    balanceSheet,
    nics,
    otherInformationSpace,
  ]);
}

/** Build all SA103F pages (one per trade). Empty when there is no self-employment. */
export function buildSa103(trades: TradeSource[] | undefined): string {
  return (trades ?? []).map(oneTrade).join('');
}
