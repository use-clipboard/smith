// SA107 — Trusts, settlements and estate income. One <SA107> for the return,
// built from income.sa107. Foreign-estate per-source detail (boxes 22/23/24) is
// summed from the shared breakdown into the schema totals.
//
// Validated against HMRC's 2025/26 MTR schema (MTR-v1-2.xsd): boxes nest under
// <IncomeFromTrustsAndSettlements>, <IncomeChargeableOnSettlors> and
// <IncomeFromEstates> (UK + foreign), then <ForeignTax>,
// <IncomeFromResidentialProperty> and <AnyOtherInformationSpace>. Element names
// and ordering below are the real schema names, not the earlier guesses.

import type { Sa107 } from '@/components/features/tax-studio/types';
import { clip, el, flag, group, moneyDown, moneyUp } from '../xml';

export function buildSa107(sa: Sa107 | undefined): string {
  if (!sa) return '';

  const fe = sa.foreignEstates ?? [];
  const foreignEstateIncome = fe.reduce((a, f) => a + (f.income || 0), 0);        // box 22
  const foreignEstateUkTax = fe.reduce((a, f) => a + (f.ukTaxWithheld || 0), 0);  // box 23
  const foreignEstateTax = fe.reduce((a, f) => a + (f.foreignTax || 0), 0);       // box 24

  // <IncomeFromTrustsAndSettlements> — discretionary + non-discretionary trusts.
  const trusts = group('IncomeFromTrustsAndSettlements', [
    group('DiscretionaryIncomePayment', [
      el('DiscretionaryIncomePaymentNetAmount', moneyDown(sa.discretionaryNet)),          // box 1
      el('PaymentsFromSettlorInterestedTrusts', moneyDown(sa.settlorInterestedPayments)), // box 2
    ]),
    group('NondiscretionaryIncomeEntitlementFromTrusts', [
      el('NonDiscretionaryIncomeTaxedAtBasicRate', moneyDown(sa.nonDiscNonSavings)),  // box 3
      el('NonDiscretionaryIncomeTaxedAtLowerRate', moneyDown(sa.nonDiscSavings)),     // box 4
      el('NonDiscretionaryIncomeTaxedAtDividendRate', moneyDown(sa.nonDiscDividend)), // box 5
      flag('IncomeFromTrustsEtcNonResidentTrustees', sa.trusteesNonResident),        // box 6
    ]),
  ]);

  // <IncomeChargeableOnSettlors> — settlor-interested income (boxes 7–15).
  const settlors = group('IncomeChargeableOnSettlors', [
    el('NetSettlorIncomeTaxedAtBasicRate', moneyDown(sa.settlorNonSavingsBasic)),        // box 7
    el('NetSettlorIncomeTaxedAtLowerRate', moneyDown(sa.settlorSavingsBasic)),           // box 8
    el('NetSettlorIncomeTaxedAtDividendRate', moneyDown(sa.settlorDividend)),            // box 9
    el('NetSettlorIncomeTaxedAtTrustRate', moneyDown(sa.settlorNonSavingsTrust)),        // box 10
    el('SavingsIncomeAtTrustRate', moneyDown(sa.settlorSavingsTrust)),                   // box 11
    el('NetSettlorIncomeTaxedAtDividendTrustRate', moneyDown(sa.settlorDividendTrust)),  // box 12
    el('GrossSettlorIncomeToBeTaxedAtBasicRate', moneyDown(sa.settlorNonSavingsGross)),  // box 13
    el('GrossSettlorIncomeToBeTaxedAtLowerRate', moneyDown(sa.settlorSavingsGross)),     // box 14
    el('AmountOfUKLifeInsurancePolicy', moneyUp(sa.lifeAssuranceTaxPaid)),               // box 15
  ]);

  // <IncomeFromEstates> — UK estates (16–19) and foreign estates (22, 22.1, 23).
  const estates = group('IncomeFromEstates', [
    group('UKEstates', [
      el('EstateIncomeTaxedAtBasicRate', moneyDown(sa.estateNonSavings)),                    // box 16
      el('EstateIncomeTaxedAtLowerRate', moneyDown(sa.estateSavings)),                       // box 17
      el('EstateIncomeTaxedAtDividendRate', moneyDown(sa.estateDividend)),                   // box 18
      el('EstateIncomeAlreadyTaxedAt75dividendRate', moneyDown(sa.estateDividend75)),        // box 18.1
      el('EstateIncomeTaxedAtNonrepayableBasicRate', moneyDown(sa.estateNonSavingsNonRepayable)), // box 19
    ]),
    group('ForeignEstates', [
      el('ForeignEstateIncome', moneyDown(foreignEstateIncome)),               // box 22
      el('ForeignEstateIncomeFIGclaim', moneyDown(sa.foreignEstateFig)),       // box 22.1
      el('ReliefForUKTaxAccountedFor', moneyUp(foreignEstateUkTax)),           // box 23
    ]),
  ]);

  return group('SA107', [
    trusts,
    settlors,
    estates,
    el('ForeignTax', moneyUp(foreignEstateTax)),                                       // box 24
    group('IncomeFromResidentialProperty', [
      el('ResidentialPropertyIncomeOrRestrictedFinanceCosts', moneyDown(sa.estateResiPropertyIncome)), // box 25
      el('UnusedResidentialFinanceCostsBroughtForward', moneyUp(sa.estateResiFinanceBfwd)),            // box 25.1
    ]),
    el('AnyOtherInformationSpace', clip(sa.otherInformation, 20480)),                   // box 26
  ]);
}
