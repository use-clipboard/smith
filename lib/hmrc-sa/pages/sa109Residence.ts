// SA109 — Residence, remittance basis etc. One <SA109> for the return, built
// from income.residence.
//
// Validated against HMRC's 2025/26 MTR schema (MTR-v1-2.xsd). Element names and
// nesting are the real schema names (not the earlier provisional guesses).
// Structure (in order):
//   SA109 → ResidenceStatus · TimeSpentInUK · PersonalAllowances
//         · ResidenceInOtherCountries · FIGOWRTRF · ForeignIncomeAndGainsFIGrelief
//         · RemittanceBasis · OverseasWorkdayReliefOWR
//         · TemporaryRepatriationFacilityTRF · AnyOtherInformationSpace
//
// Note: <RemittanceBasis> has two REQUIRED children in the schema — a single
// AmountOfReliefClaimedForInvestmentInQualifyingBusiness (1..1) and 1..3
// CompanyRegistrationNumber (each ([A-Z]{2}|[0-9]{2})[0-9]{6}). The group is
// therefore only rendered when at least one valid Business Investment Relief
// company (number + amount) is present; if it drops out, the box-37
// RemittedIncomeOrGains flag that also lives inside it is dropped with it.

import type { Sa109, Sa109Company } from '@/components/features/tax-studio/types';
import { clip, el, flag, group, isoDate, moneyDown, moneyUp } from '../xml';

/** Extract up to `max` valid 3-letter uppercase country codes from a free string. */
function countryCodes(tag: string, s: string | undefined, max: number): string[] {
  if (!s) return [];
  const out: string[] = [];
  for (const raw of String(s).split(/[^A-Za-z]+/)) {
    const code = raw.trim().toUpperCase();
    if (/^[A-Z]{3}$/.test(code) && !out.includes(code)) {
      out.push(code);
      if (out.length >= max) break;
    }
  }
  return out.map((c) => el(tag, c));
}

/** Normalise a company registration number to the schema pattern (8 chars). */
function crn(c: Sa109Company): string | null {
  const v = String(c.companyNumber ?? '').replace(/\s+/g, '').toUpperCase();
  return /^([A-Z]{2}|[0-9]{2})[0-9]{6}$/.test(v) ? v : null;
}

export function buildSa109(sa: Sa109 | undefined): string {
  if (!sa) return '';

  // ── ResidenceStatus ───────────────────────────────────────────────────────
  const residenceStatus = group('ResidenceStatus', [
    flag('NotResidentInUK', sa.notResident),
    flag('RequestForSplitYearTreatment', sa.splitYear),
    flag('MoreThanOneCaseOfSplitYearTreatmentApplies', sa.splitYearMultiple),
    flag('ResidentInUKForPreviousYear', sa.residentLastYear),
    el('SplitYearTreatmentDateFromWhichTheUKpartYearBeginsOrEnds', isoDate(sa.splitYearDate)),
    flag('MeetTheThirdAutomaticOverseasTest', sa.thirdAutoOverseasTest),
    flag('HadAGapBetweenEmploymentsInThisTaxYear', sa.gapBetweenEmployments),
    flag('HadAHomeOverseas', sa.homeOverseas),
  ]);

  // ── TimeSpentInUK (non-negative integer day counts) ───────────────────────
  const timeSpent = group('TimeSpentInUK', [
    el('NumberOfDaysSpentInUK', sa.daysInUk),
    el('NumberOfDaysDueToExceptionalCircumstances', sa.daysExceptional),
    el('NumberOfDaysInUKwhileInTransit', sa.daysTransit),
    el('HowManyTiesToUK', sa.ukTies),
    el('NumberOfWorkdaysInUKForEmployment', sa.workdaysUk),
    el('NumberOfWorkdaysSpentOverseas', sa.workdaysOverseas),
  ]);

  // ── PersonalAllowances ────────────────────────────────────────────────────
  const personalAllowances = group('PersonalAllowances', [
    flag('PersonalAllowancesClaimDueToDTA', sa.paUnderDta),
    flag('PersonalAllowancesClaimOnOtherBasis', sa.paOtherBasis),
    ...countryCodes('CodeForCountryOfNationalityOrResidence', sa.nationalResidentCountries, 3),
  ]);

  // ── ResidenceInOtherCountries ─────────────────────────────────────────────
  const otherCountries = group('ResidenceInOtherCountries', [
    ...countryCodes('CodeForCountryOfResidenceForTaxInYear', sa.residentCountryCodes, 2),
    ...countryCodes('CodeForCountryOfResidenceInPreviousYear', sa.residentCountryCodesPrior, 2),
    el('AmountOfDTAincomeForWhichPartialReliefIsClaimed', moneyDown(sa.dtaIncomeReliefAmount)),
    el('DTAReliefClaimResidenceInAnotherCountry', moneyUp(sa.dtaReliefResidence)),
    el('DTAReliefClaimOtherProvisions', moneyUp(sa.dtaReliefOther)),
  ]);

  // ── FIGOWRTRF (arrival details) ───────────────────────────────────────────
  const figArrival = group('FIGOWRTRF', [
    el('DateOfArrivalInTheUK', isoDate(sa.figArrivalDate)),
    el('UKresidentPriorToRecentArrival', /^\d{4}-\d{2}$/.test(sa.figPriorResidentYear ?? '') ? sa.figPriorResidentYear : null),
  ]);

  // ── ForeignIncomeAndGainsFIGrelief ────────────────────────────────────────
  const figRelief = group('ForeignIncomeAndGainsFIGrelief', [
    flag('ClaimForReliefOnForeignIncomeUnderFIG', sa.figIncomeClaim),
    flag('ClaimForReliefOnForeignGainsUnderFIG', sa.figGainsClaim),
    flag('QAHCincomeOrGains', sa.qahcDeemedForeign),
  ]);

  // ── RemittanceBasis (Business Investment Relief) ──────────────────────────
  // Required children: one relief amount + 1..3 company registration numbers.
  const birCompanies = (sa.figForeignIncomeReliefCompanies ?? []).filter((c) => crn(c) != null).slice(0, 3);
  const birAmount = moneyUp(birCompanies.reduce((a, c) => a + (c.amountInvested || 0), 0));
  const remittanceBasis = birCompanies.length && birAmount
    ? group('RemittanceBasis', [
        flag('RemittedIncomeOrGains', sa.remittedNominated),
        el('AmountOfReliefClaimedForInvestmentInQualifyingBusiness', birAmount),
        ...birCompanies.map((c) => el('CompanyRegistrationNumber', crn(c))),
        flag('PreviousInvestmentNoLongerQualifies', sa.investmentNoLongerQualifies),
      ])
    : '';

  // ── OverseasWorkdayReliefOWR ──────────────────────────────────────────────
  const owr = group('OverseasWorkdayReliefOWR', [
    flag('OWRelection', sa.owrElection),
    flag('OWRclaim', sa.owrClaim),
    flag('OWRtransitionalProvisionsClaim', sa.owrTransitional),
    el('QualifyingEmploymentIncomeAfterDeductions', moneyDown(sa.owrQualifyingEmpIncome)),
    el('QualifyingForeignEmploymentIncomeAfterDeductions', moneyDown(sa.owrQualifyingForeignEmpIncome)),
    el('MaximumRelief', moneyUp(sa.owrMaxRelief)),
    el('OWRclaimed', moneyUp(sa.owrClaimedOnEmpIncome)),
    el('TotalAmountReliefClaimed', moneyUp(sa.owrTotalRelief)),
  ]);

  // ── TemporaryRepatriationFacilityTRF ──────────────────────────────────────
  const trf = group('TemporaryRepatriationFacilityTRF', [
    flag('ElectionUnderTRF', sa.trfElection),
    el('PersonalTRFdesignationAmount', moneyDown(sa.trfPersonalDesignations)),
    el('CapitalPaymentsAndBenefitsReceivedFromTrusts', moneyDown(sa.trfTrustPayments)),
    el('PersonalTRFdesignationRemittedAmount', moneyDown(sa.trfRemitted)),
  ]);

  return group('SA109', [
    residenceStatus,
    timeSpent,
    personalAllowances,
    otherCountries,
    figArrival,
    figRelief,
    remittanceBasis,
    owr,
    trf,
    el('AnyOtherInformationSpace', clip(sa.otherInformation, 20480)),
  ]);
}
