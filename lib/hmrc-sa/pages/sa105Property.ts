// SA105 — UK property. HMRC files ONE SA105 for the return: the per-property
// PropertySource rows are summed into it, alongside the return-level boxes 1–4
// (which live on Sa100Income). ⚠ Element names PROVISIONAL pending the 2025/26
// XSD. ⚠ Jointly-owned property: the model stores WHOLE-property figures — the
// submitted SA105 should use the taxpayer's ownership share. TODO(phase1): apply
// the share via calc.ts (propertyTaxable) rather than summing raw figures.

import type { PropertySource, Sa100Income } from '@/components/features/tax-studio/types';
import { el, flag, group, poundsDown, poundsUp } from '../xml';

/** Sum one numeric field across all properties. */
function s(props: PropertySource[], pick: (p: PropertySource) => number | undefined): number {
  return props.reduce((a, p) => a + (pick(p) || 0), 0);
}

export function buildSa105(properties: PropertySource[] | undefined, inc: Sa100Income): string {
  const props = properties ?? [];
  if (!props.length) return '';
  return group('SA105', [
    // Return-level (boxes 1–4)
    el('NumberOfProperties', inc.propertyCount),
    flag('PropertyIncomeCeased', inc.propertyCeased),
    flag('LetJointly', inc.propertyLetJointly),
    flag('RentARoomRelief', inc.propertyRentARoom),
    // Property income (boxes 20–23)
    el('TotalRents', poundsDown(s(props, (p) => p.rents))),
    el('PropertyIncomeAllowance', poundsUp(s(props, (p) => p.propertyIncomeAllowance))),
    el('TaxTakenOffRents', poundsUp(s(props, (p) => p.taxTaken))),
    el('LeasePremiums', poundsDown(s(props, (p) => p.premiums))),
    el('ReversePremiums', poundsDown(s(props, (p) => p.reversePremiums))),
    // Allowable expenses (boxes 24–29)
    el('RentRatesInsurance', poundsUp(s(props, (p) => p.expPremises))),
    el('PropertyRepairs', poundsUp(s(props, (p) => p.expRepairs))),
    el('LoanInterestFinanceCosts', poundsUp(s(props, (p) => p.expLoanInterest))),
    el('ProfessionalFees', poundsUp(s(props, (p) => p.expProfessional))),
    el('CostOfServices', poundsUp(s(props, (p) => p.expServices))),
    el('OtherPropertyExpenses', poundsUp(s(props, (p) => p.expOther))),
    // Taxable profit / loss adjustments (boxes 30–45)
    el('PrivateUseAdjustment', poundsDown(s(props, (p) => p.privateUse))),
    el('BalancingCharges', poundsDown(s(props, (p) => p.balancingCharges))),
    el('AnnualInvestmentAllowance', poundsUp(s(props, (p) => p.aia))),
    el('StructuresBuildingsAllowance', poundsUp(s(props, (p) => p.sba))),
    el('ElectricChargepointAllowance', poundsUp(s(props, (p) => p.electricChargepoint))),
    el('ZeroEmissionCarAllowance', poundsUp(s(props, (p) => p.zeroEmissionCar))),
    el('OtherCapitalAllowances', poundsUp(s(props, (p) => p.capitalAllowances))),
    el('ReplacementDomesticItems', poundsUp(s(props, (p) => p.domesticItems))),
    el('RentARoomExempt', poundsUp(s(props, (p) => p.rentARoomExempt))),
    el('LossBroughtForward', poundsDown(s(props, (p) => p.lossBroughtForward))),
    el('LossSetOffTotalIncome', poundsDown(s(props, (p) => p.lossSetOffTotalIncome))),
    el('ResidentialFinanceCosts', poundsUp(s(props, (p) => p.residentialFinanceCosts))),
    el('UnusedResidentialFinanceCosts', poundsUp(s(props, (p) => p.unusedFinanceCostsBfwd))),
  ]);
}
