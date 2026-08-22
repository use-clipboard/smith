// SA100 core — the main tax return: personal details, the income that lives on
// the main return (interest, dividends, pensions, other UK income), tax reliefs,
// allowances, student loans, HICBC, marriage allowance, and the "finishing"
// section (refunds, repayment bank details, adviser, signing).
//
// Validated against HMRC's 2025/26 MTR schema (MTR-v1-2.xsd). Element names and
// nesting are the real schema names. Structure (in order):
//   SA100 → YourPersonalDetails (req) · StudentLoanRepayments · Income
//         · TaxReliefs · HighIncomeChildBenefitCharge
//         · WinterFuelPayment… · MarriageAllowance · MarriageAllowanceTransferred{In,Out}
//         · FinishingYourTaxReturn
// YourTaxReturn (the "which schedules are attached" declaration) is TODO — it is
// populated at the assembler once the rendered supplementary pages are known.

import type { TaxReturn, Sa100Income } from '@/components/features/tax-studio/types';
import {
  clip, digitsOnly, el, flag, group, isoDate, moneyDown, moneyUp, telephone, yesno,
} from '../xml';

/** A box that has an itemised breakdown plus a scalar fallback → the box total. */
function total(items: Array<{ amount?: number }> | undefined, scalar: number | undefined): number {
  if (items && items.length) return items.reduce((a, i) => a + (i.amount || 0), 0);
  return scalar || 0;
}
function sum(items: Array<{ amount?: number }> | undefined): number {
  return (items ?? []).reduce((a, i) => a + (i.amount || 0), 0);
}

/** Map our stored student-loan plan (1/2/4 in any form) to the schema code. */
function studentLoanPlanCode(v: unknown): string | null {
  const s = String(v ?? '').replace(/\D/g, '');
  return s === '1' ? '01' : s === '2' ? '02' : s === '4' ? '04' : null;
}

export function buildSa100Core(ret: TaxReturn): string {
  const inc: Sa100Income = ret.income;
  const tp = ret.taxpayer ?? ({} as NonNullable<TaxReturn['taxpayer']>);

  // ── YourPersonalDetails (required; TaxpayerStatus is mandatory) ────────────
  const personal = group('YourPersonalDetails', [
    el('DateOfBirth', isoDate(tp.dateOfBirth)),
    el('TelephoneNumber', telephone(tp.phone)),
    el('NationalInsuranceNumber', tp.nino),
    // C = Welsh, S = Scottish, U = rest of UK. Default U (covers most). TODO:
    // drive from the taxpayer's residency once modelled.
    el('TaxpayerStatus', 'U'),
  ]);

  // ── StudentLoanRepayments ─────────────────────────────────────────────────
  const planCode = studentLoanPlanCode(inc.studentLoanPlan);
  const hasStudentLoan = !!(planCode || inc.studentLoanRepaymentBegan || inc.studentLoanDeducted);
  const studentLoans = group('StudentLoanRepayments', [
    flag('IncomeContingentStudentLoanNotification', hasStudentLoan),
    el('StudentLoanRepaymentDeductedAmount', moneyUp(inc.studentLoanDeducted)),
    el('PostgraduateLoanRepaymentDeductedAmount', moneyUp(inc.postgradLoanDeducted)),
    el('PlanType', planCode),
    el('PostgraduateLoanPlanType', inc.postgradLoanDeducted ? '03' : null),
  ]);

  // ── Income → UK interest & dividends ──────────────────────────────────────
  const taxedInterestNet = sumField(inc.taxedInterestItems, (i) => i.net);
  const interestDividends = group('UKInterestAndDividends', [
    el('TaxedBankBuildingSocietyEtcInterest', moneyDown(taxedInterestNet)),
    el('UntaxedUKinterestEtc', moneyDown(total(inc.savingsInterestItems, inc.savingsInterest))),
    el('UntaxedForeignInterest', moneyDown(inc.untaxedForeignInterest)),
    el('CompanyDividends', moneyDown(total(inc.dividendItems, inc.dividends))),
    el('UnitTrustEtcDividends', moneyDown(total(inc.otherDividendsItems, inc.otherDividends))),
    el('ForeignDividends', moneyDown(total(inc.foreignDividendsItems, inc.foreignDividendsMain))),
    el('TaxTakenOffForeignDividends', moneyUp(total(inc.foreignDividendsTaxItems, inc.foreignDividendsTax))),
  ]);

  // ── Income → State benefits & pensions ────────────────────────────────────
  const stateBenefits = group('StateBenefits', [
    el('AnnualStatePension', moneyDown(total(inc.statePensionItems, inc.statePension))),
    el('StatePensionLumpSum', moneyDown(sum(inc.statePensionLumpSumItems))),
    el('TaxTakenOffPensionLumpSum', moneyUp(sum(inc.statePensionLumpSumTaxItems))),
    el('OtherPensionsAndRetirementAnnuities', moneyDown(total(inc.pensionsIncomeItems, inc.pensionsIncome))),
    el('TaxTakenOffPensionsAndRetirementAnnuities', moneyUp(sum(inc.pensionsIncomeTaxItems))),
    el('IncapacityBenefit', moneyDown(inc.incapacityBenefit)),
    el('TaxTakenOffIncapacityBenefit', moneyUp(inc.incapacityBenefitTax)),
    el('JobseekersAllowance', moneyDown(inc.jobseekersAllowance)),
    el('OtherStatePensionsAndBenefits', moneyDown(inc.otherPensionsBenefits)),
  ]);

  // ── Income → Other UK income ──────────────────────────────────────────────
  const otherTaxableIncome = total(inc.otherIncomeItems, inc.otherIncome);
  const otherIncomeDetails = group('OtherTaxableIncomeDetails', [
    el('OtherTaxableIncome', moneyDown(otherTaxableIncome)),
    el('TaxTakenOffOtherTaxableIncome', moneyUp(sum(inc.otherIncomeTaxItems))),
  ]);
  const otherUkIncome = group('OtherUKIncome', [
    otherIncomeDetails,
    el('AllowableExpenses', moneyUp(sum(inc.otherIncomeExpensesItems))),
    el('DeemedIncomeOrBenefits', moneyDown(sum(inc.preOwnedAssetsItems))),
    el('DescriptionOfOtherIncome', clip(inc.otherIncomeDescription, 28)),
  ]);

  const income = group('Income', [interestDividends, stateBenefits, otherUkIncome]);

  // ── TaxReliefs → Pensions, CharitableGiving, BlindPersonsAllowance ────────
  const pensionReliefs = group('Pensions', [
    el('PaymentsToRegisteredPensionSchemes', moneyDown(total(inc.pensionContributionsItems, inc.pensionContributions))),
    el('OneOffRegisteredPensionSchemesPayments', moneyDown(inc.pensionOneOff)),
    el('RetirementAnnuityContractPayments', moneyDown(sum(inc.pensionRetirementAnnuityItems))),
    el('EmployerPensionSchemePayments', moneyDown(sum(inc.pensionEmployerSchemeItems))),
    el('NonUKOverseasPensionSchemePayments', moneyDown(sum(inc.pensionOverseasItems))),
  ]);
  const charitableGiving = group('CharitableGiving', [
    el('GiftAidPaymentsMadeInYear', moneyDown(total(inc.giftAidItems, inc.giftAid))),
    el('OneOffGiftAidPayments', moneyDown(sum(inc.giftAidOneOffItems))),
    el('GiftAidPaymentsCarriedBackToPreviousYear', moneyDown(sum(inc.giftAidCarryBackItems))),
    el('GiftAidPaymentsBroughtBackFromLaterYear', moneyDown(sum(inc.giftAidFutureItems))),
    el('SharesGiftedToCharity', moneyDown(sum(inc.giftAidSharesItems))),
    el('LandAndBuildingsGiftedToCharity', moneyDown(sum(inc.giftAidLandItems))),
  ]);
  const blindDetails = group('BlindPersonsAllowanceDetails', [
    flag('RegisteredBlind', inc.registeredBlind),
    flag('SurplusBlindPersonsAllowanceToSpouse', inc.blindSpouseSurplusSurrender),
    el('LocalAuthorityName', clip(inc.blindAuthority, 28)),
  ]);
  const blindAllowance = group('BlindPersonsAllowance', [
    blindDetails,
    flag('SurplusBlindPersonsAllowanceFromSpouse', inc.blindSpouseSurplusClaim),
  ]);
  const reliefs = group('TaxReliefs', [pensionReliefs, charitableGiving, blindAllowance]);

  // ── High Income Child Benefit Charge ──────────────────────────────────────
  const hicbc = group('HighIncomeChildBenefitCharge', [
    el('AmountReceived', moneyDown(inc.childBenefit)),
    el('NumberOfChildren', inc.childBenefitChildren ? String(Math.trunc(inc.childBenefitChildren)) : null),
    el('DateStoppedReceivingAllChildBenefitPayments', isoDate(inc.childBenefitStopDate)),
  ]);

  const winterFuel = el(
    'WinterFuelPaymentOrPensionsAgeWinterHeatingPaymentReceived',
    moneyDown(inc.winterFuelPayment),
  );

  // ── Marriage Allowance (transfer OUT — recipient spouse details) ──────────
  // All five children are required when the group is present, so only build it
  // when we have the full set.
  const spouseComplete =
    inc.marriageAllowance === 'transferred' &&
    inc.spouseFirstName && inc.spouseLastName && inc.spouseNino && inc.spouseDob && inc.marriageDate;
  const marriageAllowance = spouseComplete
    ? group('MarriageAllowance', [
        el('SpouseFirstName', clip(inc.spouseFirstName, 28)),
        el('SpouseLastName', clip(inc.spouseLastName, 28)),
        el('SpouseNINO', inc.spouseNino),
        el('SpouseDateOfBirth', isoDate(inc.spouseDob)),
        el('DateOfMarriageOrCivilPartnership', isoDate(inc.marriageDate)),
      ])
    : '';
  const maTransferredIn = flag('MarriageAllowanceTransferredIn', inc.marriageAllowance === 'received');
  const maTransferredOut = flag('MarriageAllowanceTransferredOut', inc.marriageAllowance === 'transferred');

  // ── FinishingYourTaxReturn ────────────────────────────────────────────────
  const notPaidEnough = group('NotPaidEnough', [
    flag('TaxOwedNotToBeCodedOut', inc.noPayeCollectCurrentYear),
    flag('NonPAYEIncomeNotToBeCodedOut', inc.noPayeCollectNextYear),
  ]);
  const sortCode = digitsOnly(inc.repaySortCode, 6);
  const accountNumber = digitsOnly(inc.repayAccountNumber, 8);
  const bankAccount =
    inc.repayBankName && inc.repayAccountHolder && sortCode && accountNumber
      ? group('BankAccountDetails', [
          el('BankOrBuildingSocietyName', clip(inc.repayBankName, 28)),
          el('AccountHolderOrNomineeName', clip(inc.repayAccountHolder, 28)),
          el('BranchSortCode', sortCode),
          el('AccountNumber', accountNumber),
        ])
      : '';
  const paidTooMuch = group('PaidTooMuch', [group('PaymentDetails', [bankAccount])]);
  const taxAdviser = group('TaxAdviser', [
    el('TaxAdviser', clip(inc.adviserName, 28)),
    el('TaxAdviserPhoneNumber', telephone(inc.adviserPhone)),
    el('TaxAdvisersReference', clip(inc.adviserReference, 28)),
  ]);
  const signing = group('SigningYourForm', [
    flag('ProvisionalFigures', inc.provisionalFigures),
    el('CapacityOfPersonSigning', clip(inc.signingCapacity, 28)),
    el('NameOfPersonSignedFor', clip(inc.signedForPersonName, 28)),
  ]);
  const finishing = group('FinishingYourTaxReturn', [
    el('TaxRefundedOrSetOff', moneyUp(inc.taxRefundedOrSetOff)),
    notPaidEnough,
    paidTooMuch,
    taxAdviser,
    signing,
  ]);

  return group('SA100', [
    personal,
    studentLoans,
    income,
    reliefs,
    hicbc,
    winterFuel,
    marriageAllowance,
    maTransferredIn,
    maTransferredOut,
    finishing,
  ]);
}

// Local re-implementation of sumField to avoid importing a helper whose typing
// differs — sums a numeric field selected from each item.
function sumField<T>(items: T[] | undefined, pick: (t: T) => number | undefined | null): number {
  return (items ?? []).reduce((a, t) => a + (pick(t) || 0), 0);
}
