// SA100 core — the main tax return (pages TR1–TR8): personal details, the
// income that lives on the main return (interest, dividends, pensions, other
// UK income), tax reliefs, allowances, and the declaration.
//
// ⚠ Element names are PROVISIONAL pending the 2025/26 SA100 XSD (Phase 0).
// Corrections land here only. Supplementary pages are separate (./sa1xx*.ts).

import type { TaxReturn, Sa100Income } from '@/components/features/tax-studio/types';
import { el, flag, group, isoDate, poundsDown, poundsUp, sumField } from '../xml';

/** A box that has an itemised breakdown plus a scalar fallback → the box total. */
function total(items: Array<{ amount?: number }> | undefined, scalar: number | undefined): number {
  if (items && items.length) return sumField(items, (i) => i.amount);
  return scalar || 0;
}

export function buildSa100Core(ret: TaxReturn): string {
  const inc: Sa100Income = ret.income;
  const tp = ret.taxpayer ?? {};

  // ── TR1 Personal details ──────────────────────────────────────────────────
  const personal = group('YourPersonalDetails', [
    el('Name', ret.clientName),
    el('UTR', ret.utr ?? undefined),
    el('NINO', tp.nino),
    el('DateOfBirth', isoDate(tp.dateOfBirth)),
    el('Address', tp.address),
    el('Phone', tp.phone),
  ]);

  // ── TR3 Interest & dividends (boxes 1–7) ──────────────────────────────────
  const taxedInterestNet = sumField(inc.taxedInterestItems, (i) => i.net);
  const taxedInterestTax = sumField(inc.taxedInterestItems, (i) => i.tax);
  const interest = group('InterestAndDividends', [
    el('TaxedUKInterest', poundsDown(taxedInterestNet)),
    el('TaxTakenOffInterest', poundsUp(taxedInterestTax)),
    el('UntaxedUKInterest', poundsDown(total(inc.savingsInterestItems, inc.savingsInterest))),
    el('UntaxedForeignInterest', poundsDown(inc.untaxedForeignInterest)),
    el('DividendsFromUKCompanies', poundsDown(total(inc.dividendItems, inc.dividends))),
    el('OtherDividends', poundsDown(total(inc.otherDividendsItems, inc.otherDividends))),
    el('ForeignDividends', poundsDown(total(inc.foreignDividendsItems, inc.foreignDividendsMain))),
    el('TaxOnForeignDividends', poundsUp(total(inc.foreignDividendsTaxItems, inc.foreignDividendsTax))),
  ]);

  // ── TR3 UK pensions & state benefits (boxes 8–16) ─────────────────────────
  const pensions = group('PensionsAndBenefits', [
    el('StatePension', poundsDown(total(inc.statePensionItems, inc.statePension))),
    el('StatePensionLumpSum', poundsDown(sumField(inc.statePensionLumpSumItems, (i) => i.amount))),
    el('TaxOnStatePensionLumpSum', poundsUp(sumField(inc.statePensionLumpSumTaxItems, (i) => i.amount))),
    el('OtherPensions', poundsDown(total(inc.pensionsIncomeItems, inc.pensionsIncome))),
    el('TaxOnOtherPensions', poundsUp(sumField(inc.pensionsIncomeTaxItems, (i) => i.amount))),
    el('IncapacityBenefit', poundsDown(inc.incapacityBenefit)),
    el('TaxOnIncapacityBenefit', poundsUp(inc.incapacityBenefitTax)),
    el('JobseekersAllowance', poundsDown(inc.jobseekersAllowance)),
    el('OtherStateBenefits', poundsDown(inc.otherPensionsBenefits)),
  ]);

  // ── TR3 Other UK income (boxes 17–21) ─────────────────────────────────────
  const otherIncome = group('OtherUKIncome', [
    el('OtherTaxableIncome', poundsDown(total(inc.otherIncomeItems, inc.otherIncome))),
    el('AllowableExpenses', poundsUp(sumField(inc.otherIncomeExpensesItems, (i) => i.amount))),
    el('TaxOnOtherIncome', poundsUp(sumField(inc.otherIncomeTaxItems, (i) => i.amount))),
    el('BenefitFromPreOwnedAssets', poundsDown(sumField(inc.preOwnedAssetsItems, (i) => i.amount))),
    el('OtherIncomeDescription', inc.otherIncomeDescription),
  ]);

  // ── TR4 Tax reliefs — pension payments & charitable giving ────────────────
  const reliefs = group('TaxReliefs', [
    el('PersonalPensionPayments', poundsDown(total(inc.pensionContributionsItems, inc.pensionContributions))),
    el('PensionOneOffPayments', poundsDown(inc.pensionOneOff)),
    el('RetirementAnnuityPayments', poundsDown(sumField(inc.pensionRetirementAnnuityItems, (i) => i.amount))),
    el('EmployerSchemePayments', poundsDown(sumField(inc.pensionEmployerSchemeItems, (i) => i.amount))),
    el('OverseasPensionPayments', poundsDown(sumField(inc.pensionOverseasItems, (i) => i.amount))),
    el('GiftAidPayments', poundsDown(total(inc.giftAidItems, inc.giftAid))),
    el('GiftAidOneOff', poundsDown(sumField(inc.giftAidOneOffItems, (i) => i.amount))),
    el('GiftAidCarriedBack', poundsDown(sumField(inc.giftAidCarryBackItems, (i) => i.amount))),
    el('GiftAidBroughtForward', poundsDown(sumField(inc.giftAidFutureItems, (i) => i.amount))),
    el('GiftAidSharesSecurities', poundsDown(sumField(inc.giftAidSharesItems, (i) => i.amount))),
    el('GiftAidLandBuildings', poundsDown(sumField(inc.giftAidLandItems, (i) => i.amount))),
  ]);

  // ── TR4 Allowances — Blind Person's Allowance, Marriage Allowance ─────────
  const allowances = group('Allowances', [
    flag('RegisteredBlind', inc.registeredBlind),
    el('BlindPersonAuthority', inc.blindAuthority),
    flag('ClaimSpouseSurplusAllowance', inc.blindSpouseSurplusClaim),
    flag('SurrenderSurplusAllowanceToSpouse', inc.blindSpouseSurplusSurrender),
    inc.marriageAllowance === 'transferred' ? flag('MarriageAllowanceTransfer', true) : '',
    inc.marriageAllowance === 'received' ? flag('MarriageAllowanceReceived', true) : '',
  ]);

  // ── TR4 Student & Postgraduate Loans (boxes 1–3) ──────────────────────────
  const loans = group('StudentLoans', [
    inc.studentLoanPlan ? el('PlanType', String(inc.studentLoanPlan)) : '',
    flag('RepaymentsBegan', inc.studentLoanRepaymentBegan),
    el('StudentLoanDeducted', poundsUp(inc.studentLoanDeducted)),
    el('PostgradLoanDeducted', poundsUp(inc.postgradLoanDeducted)),
  ]);

  // ── TR5 High Income Child Benefit Charge & Marriage Allowance spouse ──────
  const tr5 = group('HighIncomeAndMarriage', [
    el('ChildBenefitReceived', poundsDown(inc.childBenefit)),
    el('NumberOfChildren', inc.childBenefitChildren),
    el('ChildBenefitStoppedDate', isoDate(inc.childBenefitStopDate)),
    el('WinterFuelPayment', poundsDown(inc.winterFuelPayment)),
    el('SpouseFirstName', inc.spouseFirstName),
    el('SpouseLastName', inc.spouseLastName),
    el('SpouseNINO', inc.spouseNino),
    el('SpouseDateOfBirth', isoDate(inc.spouseDob)),
    el('DateOfMarriage', isoDate(inc.marriageDate)),
  ]);

  // ── TR6 Finishing — refunds, repayment/nominee, adviser ───────────────────
  const finishing = group('FinishingYourReturn', [
    el('TaxRefundedOrSetOff', poundsUp(inc.taxRefundedOrSetOff)),
    flag('DoNotCollectThroughCurrentPAYE', inc.noPayeCollectCurrentYear),
    flag('DoNotCollectThroughNextPAYE', inc.noPayeCollectNextYear),
    el('RepaymentBankName', inc.repayBankName),
    el('RepaymentAccountHolder', inc.repayAccountHolder),
    el('RepaymentSortCode', inc.repaySortCode),
    el('RepaymentAccountNumber', inc.repayAccountNumber),
    el('AdviserName', inc.adviserName),
    el('AdviserPhone', inc.adviserPhone),
    el('AdviserAddress', inc.adviserAddress),
    el('AdviserReference', inc.adviserReference),
  ]);

  // ── TR8 Declaration / signing ─────────────────────────────────────────────
  const declaration = group('Declaration', [
    flag('ProvisionalFigures', inc.provisionalFigures),
    flag('SupplementaryPagesAttached', inc.separateSupplementaryPages),
    el('DateSigned', isoDate(inc.dateSigned)),
    el('Capacity', inc.signingCapacity),
    el('SignedForPersonName', inc.signedForPersonName),
  ]);

  return group('SA100', [
    personal, interest, pensions, otherIncome,
    reliefs, allowances, loans, tr5, finishing, declaration,
  ]);
}
