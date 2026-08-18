// SA107 — Trusts, settlements and estates. One <SA107> for the return, from
// income.sa107. Foreign-estate per-source detail (boxes 22–24) summed into the
// totals. ⚠ Element names PROVISIONAL pending the 2025/26 XSD.

import type { Sa107 } from '@/components/features/tax-studio/types';
import { el, flag, group, poundsDown, poundsUp } from '../xml';

export function buildSa107(sa: Sa107 | undefined): string {
  if (!sa) return '';
  const fe = sa.foreignEstates ?? [];
  const foreignEstateIncome = fe.reduce((a, f) => a + (f.income || 0), 0);   // box 22
  const foreignEstateUkTax = fe.reduce((a, f) => a + (f.ukTaxWithheld || 0), 0); // box 23
  const foreignEstateTax = fe.reduce((a, f) => a + (f.foreignTax || 0), 0);  // box 24
  return group('SA107', [
    // Income from Trusts
    el('DiscretionaryIncomeNet', poundsDown(sa.discretionaryNet)),
    el('SettlorInterestedPayments', poundsDown(sa.settlorInterestedPayments)),
    el('NonDiscNonSavings', poundsDown(sa.nonDiscNonSavings)),
    el('NonDiscSavings', poundsDown(sa.nonDiscSavings)),
    el('NonDiscDividend', poundsDown(sa.nonDiscDividend)),
    flag('TrusteesNonResident', sa.trusteesNonResident),
    // Income chargeable on settlors
    el('SettlorNonSavingsBasic', poundsDown(sa.settlorNonSavingsBasic)),
    el('SettlorSavingsBasic', poundsDown(sa.settlorSavingsBasic)),
    el('SettlorDividend', poundsDown(sa.settlorDividend)),
    el('SettlorNonSavingsTrust', poundsDown(sa.settlorNonSavingsTrust)),
    el('SettlorSavingsTrust', poundsDown(sa.settlorSavingsTrust)),
    el('SettlorDividendTrust', poundsDown(sa.settlorDividendTrust)),
    el('SettlorNonSavingsGross', poundsDown(sa.settlorNonSavingsGross)),
    el('SettlorSavingsGross', poundsDown(sa.settlorSavingsGross)),
    el('LifeAssuranceTaxPaid', poundsUp(sa.lifeAssuranceTaxPaid)),
    // Income from UK estates
    el('EstateNonSavings', poundsDown(sa.estateNonSavings)),
    el('EstateSavings', poundsDown(sa.estateSavings)),
    el('EstateDividend', poundsDown(sa.estateDividend)),
    el('EstateNonSavingsNonRepayable', poundsDown(sa.estateNonSavingsNonRepayable)),
    // Foreign estates (boxes 22–24, summed from the per-source breakdown)
    el('ForeignEstateIncome', poundsDown(foreignEstateIncome)),
    el('ForeignEstateUKTaxWithheld', poundsUp(foreignEstateUkTax)),
    el('ForeignEstateForeignTax', poundsUp(foreignEstateTax)),
    el('EstateResidentialPropertyIncome', poundsDown(sa.estateResiPropertyIncome)),
    el('OtherInformation', sa.otherInformation),
  ]);
}
