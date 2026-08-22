// SA105 — UK property. HMRC files ONE SA105 for the return: the per-property
// PropertySource rows are summed into it, alongside the return-level boxes 1–4
// (which live on Sa100Income).
//
// Validated against HMRC's 2025/26 MTR schema (MTR-v1-2.xsd): SA105 nests boxes
// under <UKPropertyDetails> (boxes 1–4), <PropertyIncomeAndExpenses> (income +
// allowable expenses) and <TaxableProfitOrLoss> (adjustments, allowances and
// losses). Element names/order below are the real schema names — the computed
// boxes (AdjustedProfitForTheYear / TaxableProfitForTheYear / AdjustedLossForThe
// Year / LossToCarryForward) are HMRC-derived and intentionally not emitted.
//
// ⚠ Jointly-owned property: the model stores WHOLE-property figures — the
// submitted SA105 should use the taxpayer's ownership share. TODO(phase1): apply
// the share via calc.ts (propertyTaxable) rather than summing raw figures.

import type { PropertySource, Sa100Income } from '@/components/features/tax-studio/types';
import {
  propertyItemised, propertyAdjustedProfit, propertyAdjustedLoss, propertyTaxable,
} from '@/components/features/tax-studio/calc';
import { el, flag, group, moneyDown, moneyUp } from '../xml';

// The income to report in box 20. For an itemised property that's the rents; for
// a property held only as a net accounts profit (no rents/expenses entered), the
// calc treats `profit` as the reportable income — so we surface it here too, or
// HMRC would compute tax on less income than our own SA110 figure (self-calc
// mismatch). Both sides use the SAME `propertyItemised` test to stay in step.
function reportedIncome(p: PropertySource): number {
  return propertyItemised(p) ? (p.rents || 0) : (p.profit || 0);
}

/** Sum one numeric field across all properties. */
function s(props: PropertySource[], pick: (p: PropertySource) => number | undefined): number {
  return props.reduce((a, p) => a + (pick(p) || 0), 0);
}

export function buildSa105(properties: PropertySource[] | undefined, inc: Sa100Income): string {
  const props = properties ?? [];
  if (!props.length) return '';

  // ── UKPropertyDetails (boxes 1–4) — return-level flags from Sa100Income ──
  const details = group('UKPropertyDetails', [
    el('NumberOfProperties', inc.propertyCount),
    flag('PropertyIncomeCeasedInYear', inc.propertyCeased),
    flag('IncomeFromPropertyLetJointly', inc.propertyLetJointly),
    flag('RentARoomReliefClaim', inc.propertyRentARoom),
  ]);

  // ── PropertyIncomeAndExpenses (boxes 20–29) ──
  const incomeAndExpenses = group('PropertyIncomeAndExpenses', [
    el('TotalRentsAndOtherIncomeFromProperty', moneyDown(s(props, reportedIncome))),
    el('PropertyIncomeAllowance', moneyUp(s(props, (p) => p.propertyIncomeAllowance))),
    flag('TraditionalAccounting', props.some((p) => p.traditionalAccounting)),
    el('TaxTakenOffAnyIncome', moneyUp(s(props, (p) => p.taxTaken))),
    el('PremiumsForGrantOfALease', moneyDown(s(props, (p) => p.premiums))),
    el('ReversePremiumsAndInducements', moneyDown(s(props, (p) => p.reversePremiums))),
    el('RentRatesInsuranceAndGroundRents', moneyUp(s(props, (p) => p.expPremises))),
    el('RepairsAndMaintenance', moneyUp(s(props, (p) => p.expRepairs))),
    el('AllowableInterestAndOtherFinancialCharges', moneyUp(s(props, (p) => p.expLoanInterest))),
    el('LegalManagementAndProfessionalFees', moneyUp(s(props, (p) => p.expProfessional))),
    el('CostsOfServicesProvided', moneyUp(s(props, (p) => p.expServices))),
    el('OtherPropertyExpenses', moneyUp(s(props, (p) => p.expOther))),
  ]);

  // ── TaxableProfitOrLoss (boxes 30–45) ──
  // HMRC's business rules REQUIRE the software to supply the computed adjusted
  // profit/loss and taxable profit (self-calculation): [PRO38] must be present
  // when the property makes a net profit, etc. We compute them with the same
  // helpers the SA110 tax calc uses, summed across properties, so the SA105 and
  // SA110 agree and HMRC's re-derivation matches.
  const adjustedProfit = s(props, propertyAdjustedProfit);   // box 38
  const taxableProfit = s(props, propertyTaxable);           // box 40
  const adjustedLoss = s(props, propertyAdjustedLoss);       // box 41
  const lossToCarryForward = s(props, (p) =>
    propertyAdjustedLoss(p) + Math.max(0, (p.lossBroughtForward || 0) - propertyAdjustedProfit(p)));

  const profitOrLoss = group('TaxableProfitOrLoss', [
    el('PrivateUseAdjustment', moneyDown(s(props, (p) => p.privateUse))),
    el('BalancingCharges', moneyDown(s(props, (p) => p.balancingCharges))),
    el('AnnualInvestmentAllowance', moneyUp(s(props, (p) => p.aia))),
    el('TheStructuresAndBuildingsAllowance', moneyUp(s(props, (p) => p.sba))),
    el('ElectricChargePointAllowance', moneyUp(s(props, (p) => p.electricChargepoint))),
    el('FreeportAndInvestmentZonesStructuresAndBuildingsAllowance', moneyUp(s(props, (p) => p.freeportSba))),
    el('ZeroEmissionCarAllowance', moneyUp(s(props, (p) => p.zeroEmissionCar))),
    el('EnhancedCapitalAllowances', moneyUp(s(props, (p) => p.capitalAllowances))),
    el('CostsOfReplacingDomesticItems', moneyUp(s(props, (p) => p.domesticItems))),
    el('RentARoomExemptAmount', moneyUp(s(props, (p) => p.rentARoomExempt))),
    el('AdjustedProfitForTheYear', moneyDown(adjustedProfit)),
    el('LossBroughtForward', moneyUp(s(props, (p) => p.lossBroughtForward))),
    el('TaxableProfitForTheYear', moneyDown(taxableProfit)),
    el('AdjustedLossForTheYear', moneyDown(adjustedLoss)),
    el('LossSetOffAgainstTotalIncomeOfTheYear', moneyUp(s(props, (p) => p.lossSetOffTotalIncome))),
    el('LossToCarryForward', moneyDown(lossToCarryForward)),
    el('ResidentialFinanceCosts', moneyUp(s(props, (p) => p.residentialFinanceCosts))),
    el('UnusedResidentialFinanceCostsBroughtForward', moneyUp(s(props, (p) => p.unusedFinanceCostsBfwd))),
  ]);

  return group('SA105', [details, incomeAndExpenses, profitOrLoss]);
}
