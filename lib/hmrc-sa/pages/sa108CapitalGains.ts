// SA108 — Capital gains summary. One <SA108> for the return, from income.sa108.
//
// Validated against HMRC's 2025/26 MTR schema (MTR-v1-2.xsd): the SA108 element
// nests boxes under eight optional containers — ResidentialPropertyAndCarried‑
// Interest, Cryptoassets, OtherPropertyAssetsAndGains, ListedSharesAndSecurities,
// UnlistedSharesAndSecurities, LossesAndAdjustments,
// NRCGTonUKpropertyOrLandAndIndirectDisposals and EISandQAHC — followed by
// EstimateOrValuation and AnyOtherInformationSpace. Element names/order below are
// the real schema names, not the earlier provisional guesses. No child is
// required, so every group() drops out cleanly when empty.

import type { Sa108 } from '@/components/features/tax-studio/types';
import { clip, el, flag, group, moneyDown, moneyUp } from '../xml';

/** NumberOfDisposals is xsd:positiveInteger (1..99999) — round and drop non-positive. */
function count(n: number | null | undefined): string | null {
  if (n == null || !Number.isFinite(n)) return null;
  const v = Math.round(n);
  return v > 0 ? String(v) : null;
}

/** MTR_SACGTreliefCodeType — exactly three uppercase letters ([A-Z]{3}). */
function reliefCode(s: string | null | undefined): string | null {
  if (s == null) return null;
  const c = String(s).toUpperCase().replace(/[^A-Z]/g, '');
  return c.length === 3 ? c : null;
}

export function buildSa108(sa: Sa108 | undefined): string {
  if (!sa) return '';

  // Residential property and carried interest — boxes 3–13C.
  const residential = group('ResidentialPropertyAndCarriedInterest', [
    el('NumberOfDisposals', count(sa.resiDisposals)),
    el('DisposalProceeds', moneyDown(sa.resiProceeds)),
    el('AllowableCosts', moneyUp(sa.resiCosts)),
    el('GainsOnResidentialPropertyInTheYear', moneyDown(sa.resiGains)),
    el('GainsOnResidentialPropertyFIGclaim', moneyDown(sa.resiFig)),
    el('LossesInTheYear', moneyUp(sa.resiLosses)),
    el('ClaimOrElectionMade', reliefCode(sa.resiClaimCode)),
    el('GainOrLossFromUKpropertyDisposal', moneyDown(sa.resiPptGains)),
    el('UKpropertyDisposalTaxAlreadyCharged', moneyUp(sa.resiPptTaxCharged)),
    el('GainOrLossFromRTTreturn', moneyDown(sa.resiOverallGain)),
    el('RTTtaxAlreadyCharged', moneyUp(sa.resiOverallTaxPaid)),
    el('CarriedInterestArisingBasis', moneyDown(sa.carriedInterestArising)),
    el('CarriedInterestAccrualsBasis', moneyDown(sa.carriedInterestAccruals)),
    el('GainsOnCarriedInterestInTheYear', moneyDown(sa.carriedInterestGains)),
    el('GainsOnCarriedInterestFIGclaim', moneyDown(sa.carriedInterestFig)),
  ]);

  // Cryptoassets — boxes 13.1–13.8.
  const crypto = group('Cryptoassets', [
    el('NumberOfDisposals', count(sa.cryptoDisposals)),
    el('DisposalProceeds', moneyDown(sa.cryptoProceeds)),
    el('AllowableCosts', moneyUp(sa.cryptoCosts)),
    el('GainsInTheYear', moneyDown(sa.cryptoGains)),
    el('LossesInTheYear', moneyUp(sa.cryptoLosses)),
    el('ClaimOrElectionMade', reliefCode(sa.cryptoClaimCode)),
    el('GainFromRTTreturn', moneyDown(sa.cryptoRtt)),
    el('RTTtaxAlreadyCharged', moneyUp(sa.cryptoRttTaxPaid)),
  ]);

  // Other property, assets and gains — boxes 14–22.
  const other = group('OtherPropertyAssetsAndGains', [
    el('NumberOfDisposals', count(sa.otherDisposals)),
    el('DisposalProceeds', moneyDown(sa.otherProceeds)),
    el('AllowableCosts', moneyUp(sa.otherCosts)),
    el('GainsInTheYear', moneyDown(sa.otherGains)),
    el('GainsFIGclaim', moneyDown(sa.otherFig)),
    el('NonResidentialDisposalsIncludedInBox17', moneyDown(sa.otherNonResiLand)),
    el('LandAndPropertyDisposalsWhereBADRisBeingClaimed', moneyDown(sa.otherBadrResiLand)),
    el('SharesDisposalsWhereBADRisBeingClaimed', moneyDown(sa.otherBadrShares)),
    el('OtherDisposalsWhereBADRisBeingClaimed', moneyDown(sa.otherBadrOther)),
    el('LossesInTheYear', moneyUp(sa.otherLosses)),
    el('ClaimOrElectionMade', reliefCode(sa.otherClaimCode)),
    el('GainFromRTTreturn', moneyDown(sa.otherRtt)),
    el('RTTtaxAlreadyCharged', moneyUp(sa.otherRttTaxPaid)),
  ]);

  // Listed shares and securities — boxes 23–30.
  const listed = group('ListedSharesAndSecurities', [
    el('NumberOfDisposals', count(sa.listedDisposals)),
    el('DisposalProceeds', moneyDown(sa.listedProceeds)),
    el('AllowableCosts', moneyUp(sa.listedCosts)),
    el('GainsInTheYear', moneyDown(sa.listedGains)),
    el('GainsFIGclaim', moneyDown(sa.listedFig)),
    el('LossesInTheYear', moneyUp(sa.listedLosses)),
    el('ClaimOrElectionMade', reliefCode(sa.listedClaimCode)),
    el('GainFromRTTreturn', moneyDown(sa.listedRtt)),
    el('RTTtaxAlreadyCharged', moneyUp(sa.listedRttTaxPaid)),
  ]);

  // Unlisted shares and securities — boxes 31–44.
  const unlisted = group('UnlistedSharesAndSecurities', [
    el('NumberOfDisposals', count(sa.unlistedDisposals)),
    el('DisposalProceeds', moneyDown(sa.unlistedProceeds)),
    el('AllowableCosts', moneyUp(sa.unlistedCosts)),
    el('GainsInTheYear', moneyDown(sa.unlistedGains)),
    el('GainsFIGclaim', moneyDown(sa.unlistedFig)),
    el('LossesInTheYear', moneyUp(sa.unlistedLosses)),
    el('ClaimOrElectionMade', reliefCode(sa.unlistedClaimCode)),
    el('GainFromRTTreturn', moneyDown(sa.unlistedRtt)),
    el('RTTtaxAlreadyCharged', moneyUp(sa.unlistedRttTaxPaid)),
    el('GainsExceedingESSlimit', moneyDown(sa.essExceedingLimit)),
    el('GainsInvestedUnderSeedEIS', moneyDown(sa.seisReinvestment)),
    el('LossesUsedAgainstReturnYearIncome', moneyUp(sa.lossesUsedAgainstIncome1)),
    el('SEISandEISlossReliefInReturnYear', moneyUp(sa.shareLossRelief1)),
    el('LossesUsedAgainstPreviousReturnYearIncome', moneyUp(sa.lossesUsedAgainstIncome2)),
    el('SEISandEISlossReliefInPreviousReturnYear', moneyUp(sa.shareLossRelief2)),
  ]);

  // Losses and adjustments — boxes 45–52.
  const losses = group('LossesAndAdjustments', [
    el('LossesBroughtForwardAndUsedInTheReturnYear', moneyUp(sa.lossesBfUsed)),
    el('IncomeLossesOfTheReturnYearSetAgainstGains', moneyUp(sa.incomeLossesSetAgainst)),
    el('LossesToBeCarriedForward', moneyUp(sa.lossesCarriedForward)),
    el('LossesUsedAgainstEarlierReturnYearsGain', moneyUp(sa.lossesUsedEarlierYear)),
    el('GainsQualifyingForInvestorsRelief', moneyDown(sa.erGainsPre2010)),
    el('GainsQualifyingForBusinessAssetDisposalRelief', moneyDown(sa.badrGains)),
    el('BADRandERclaimedToDate', moneyDown(sa.badrLifetimeClaimed)),
    el('AdjustmentToCGT', moneyDown(sa.cgtAdjustments)),
    el('NonResidentdualResidentTrustLiability', moneyDown(sa.nonResTrustLiability)),
  ]);

  // Non-resident CGT on UK property/land and indirect disposals — boxes 52.1–52.5.
  const nrcgt = group('NRCGTonUKpropertyOrLandAndIndirectDisposals', [
    el('TotalGainsChargeableForDirectDisposalsForUKresidentialProperty', moneyDown(sa.nrcgtResiProperty)),
    el('TotalGainsChargeableForDirectDisposalsForUKNRproperty', moneyDown(sa.nrcgtNonResiProperty)),
    flag('GainsFromIndirectDisposals', sa.nrcgtIndirect),
    el('TaxOnGainsAlreadyCharged', moneyUp(sa.nrcgtTaxCharged)),
    el('TotalLossesAvailableAgainstNRCGTgainsForTheYear', moneyUp(sa.nrcgtLosses)),
  ]);

  // EIS excluded indexed securities and QAHC — boxes 52EG–52QL.
  const eisQahc = group('EISandQAHC', [
    el('TotalGainsFromEIS', moneyDown(sa.eisExcludedSecurities)),
    el('EISgainsFIGclaim', moneyDown(sa.eisExcludedFig)),
    el('TotalGainsFromQAHC', moneyDown(sa.qahcGains)),
    el('QAHCgainsFIGclaim', moneyDown(sa.qahcGainsFig)),
    el('TotalLossesFromQAHC', moneyUp(sa.qahcLosses)),
  ]);

  return group('SA108', [
    residential,
    crypto,
    other,
    listed,
    unlisted,
    losses,
    nrcgt,
    eisQahc,
    // Any other information — boxes 53–54.
    flag('EstimateOrValuation', sa.estimatesOrValuations),
    el('AnyOtherInformationSpace', clip(sa.otherInformation, 20480)),
  ]);
}
