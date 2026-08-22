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
import { el, flag, group, moneyDown, moneyUp } from '../xml';

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
    el('TotalRentsAndOtherIncomeFromProperty', moneyDown(s(props, (p) => p.rents))),
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

  // ── TaxableProfitOrLoss (boxes 30–45) — computed boxes omitted (HMRC-derived) ──
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
    el('LossBroughtForward', moneyUp(s(props, (p) => p.lossBroughtForward))),
    el('LossSetOffAgainstTotalIncomeOfTheYear', moneyUp(s(props, (p) => p.lossSetOffTotalIncome))),
    el('ResidentialFinanceCosts', moneyUp(s(props, (p) => p.residentialFinanceCosts))),
    el('UnusedResidentialFinanceCostsBroughtForward', moneyUp(s(props, (p) => p.unusedFinanceCostsBfwd))),
  ]);

  return group('SA105', [details, incomeAndExpenses, profitOrLoss]);
}
