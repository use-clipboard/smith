// SA109 — Residence, remittance basis etc. One <SA109> for the return, from
// income.residence. Material boxes mapped (residence status, day counts/ties,
// DTA reliefs, FIG regime, Overseas Workday Relief, TRF). ⚠ Element names
// PROVISIONAL pending the 2025/26 XSD.

import type { Sa109 } from '@/components/features/tax-studio/types';
import { el, flag, group, isoDate, poundsDown } from '../xml';

export function buildSa109(sa: Sa109 | undefined): string {
  if (!sa) return '';
  return group('SA109', [
    // Residence status (page 1)
    flag('NotResident', sa.notResident),
    flag('SplitYear', sa.splitYear),
    flag('SplitYearMultipleCases', sa.splitYearMultiple),
    flag('ResidentLastYear', sa.residentLastYear),
    el('SplitYearDate', isoDate(sa.splitYearDate)),
    flag('ThirdAutomaticOverseasTest', sa.thirdAutoOverseasTest),
    flag('GapBetweenEmployments', sa.gapBetweenEmployments),
    flag('HomeOverseas', sa.homeOverseas),
    el('DaysInUK', sa.daysInUk),
    el('DaysExceptionalCircumstances', sa.daysExceptional),
    el('DaysInTransit', sa.daysTransit),
    el('UKTies', sa.ukTies),
    el('WorkdaysInUK', sa.workdaysUk),
    el('WorkdaysOverseas', sa.workdaysOverseas),
    // Personal allowances & domicile (page 2)
    flag('PersonalAllowancesUnderDTA', sa.paUnderDta),
    flag('PersonalAllowancesOtherBasis', sa.paOtherBasis),
    el('NationalResidentCountries', sa.nationalResidentCountries),
    el('ResidentCountryCodes', sa.residentCountryCodes),
    el('DTAIncomeReliefAmount', poundsDown(sa.dtaIncomeReliefAmount)),
    el('DTAReliefResidence', poundsDown(sa.dtaReliefResidence)),
    el('DTAReliefOther', poundsDown(sa.dtaReliefOther)),
    el('FIGArrivalDate', isoDate(sa.figArrivalDate)),
    // FIG regime & remittance basis
    flag('FIGIncomeClaim', sa.figIncomeClaim),
    flag('FIGGainsClaim', sa.figGainsClaim),
    flag('QAHCDeemedForeign', sa.qahcDeemedForeign),
    flag('RemittedNominatedIncome', sa.remittedNominated),
    // Overseas Workday Relief
    flag('OWRElection', sa.owrElection),
    flag('OWRClaim', sa.owrClaim),
    el('OWRQualifyingEmploymentIncome', poundsDown(sa.owrQualifyingEmpIncome)),
    el('OWRTotalRelief', poundsDown(sa.owrTotalRelief)),
    // Temporary Repatriation Facility
    flag('TRFElection', sa.trfElection),
    el('TRFPersonalDesignations', poundsDown(sa.trfPersonalDesignations)),
    el('TRFTrustPayments', poundsDown(sa.trfTrustPayments)),
    el('TRFRemitted', poundsDown(sa.trfRemitted)),
    // Any other information
    el('OtherInformation', sa.otherInformation),
  ]);
}
