// SA108 — Capital gains summary. One <SA108> for the return, from income.sa108
// (the box-for-box page; the CGT calculator totals into it). Material boxes
// mapped; the rare sub-boxes (crypto, carried interest, QAHC, EIS-excluded,
// NRCGT detail) are TODO(phase1). ⚠ Element names PROVISIONAL pending the XSD.

import type { Sa108 } from '@/components/features/tax-studio/types';
import { el, flag, group, poundsDown, poundsUp } from '../xml';

export function buildSa108(sa: Sa108 | undefined): string {
  if (!sa) return '';
  return group('SA108', [
    // Residential property (boxes 3–12)
    el('ResidentialDisposals', sa.resiDisposals),
    el('ResidentialProceeds', poundsDown(sa.resiProceeds)),
    el('ResidentialCosts', poundsUp(sa.resiCosts)),
    el('ResidentialGains', poundsDown(sa.resiGains)),
    el('ResidentialLosses', poundsUp(sa.resiLosses)),
    el('ResidentialClaimCode', sa.resiClaimCode),
    el('ResidentialPPTGains', poundsDown(sa.resiPptGains)),
    el('ResidentialPPTTaxCharged', poundsUp(sa.resiPptTaxCharged)),
    el('ResidentialOverallGain', poundsDown(sa.resiOverallGain)),
    el('ResidentialOverallTaxPaid', poundsUp(sa.resiOverallTaxPaid)),
    // Other property, assets and gains (boxes 14–22)
    el('OtherDisposals', sa.otherDisposals),
    el('OtherProceeds', poundsDown(sa.otherProceeds)),
    el('OtherCosts', poundsUp(sa.otherCosts)),
    el('OtherGains', poundsDown(sa.otherGains)),
    el('OtherLosses', poundsUp(sa.otherLosses)),
    el('OtherClaimCode', sa.otherClaimCode),
    // Listed shares and securities (boxes 23–30)
    el('ListedDisposals', sa.listedDisposals),
    el('ListedProceeds', poundsDown(sa.listedProceeds)),
    el('ListedCosts', poundsUp(sa.listedCosts)),
    el('ListedGains', poundsDown(sa.listedGains)),
    el('ListedLosses', poundsUp(sa.listedLosses)),
    el('ListedClaimCode', sa.listedClaimCode),
    // Unlisted shares and securities (boxes 31–44)
    el('UnlistedDisposals', sa.unlistedDisposals),
    el('UnlistedProceeds', poundsDown(sa.unlistedProceeds)),
    el('UnlistedCosts', poundsUp(sa.unlistedCosts)),
    el('UnlistedGains', poundsDown(sa.unlistedGains)),
    el('UnlistedLosses', poundsUp(sa.unlistedLosses)),
    el('UnlistedClaimCode', sa.unlistedClaimCode),
    el('SEISReinvestment', poundsDown(sa.seisReinvestment)),
    el('LossesUsedAgainstIncome', poundsUp(sa.lossesUsedAgainstIncome1)),
    el('ShareLossRelief', poundsUp(sa.shareLossRelief1)),
    // Losses and adjustments (boxes 45–52)
    el('LossesBroughtForwardUsed', poundsUp(sa.lossesBfUsed)),
    el('IncomeLossesSetAgainstGains', poundsUp(sa.incomeLossesSetAgainst)),
    el('LossesCarriedForward', poundsDown(sa.lossesCarriedForward)),
    el('LossesUsedEarlierYear', poundsUp(sa.lossesUsedEarlierYear)),
    el('InvestorsReliefGains', poundsDown(sa.erGainsPre2010)),
    el('BADRGains', poundsDown(sa.badrGains)),
    el('BADRLifetimeClaimed', poundsDown(sa.badrLifetimeClaimed)),
    el('CGTAdjustments', poundsDown(sa.cgtAdjustments)),
    el('NonResidentTrustLiability', poundsDown(sa.nonResTrustLiability)),
    // Non-resident CGT (boxes 52.1–52.5)
    el('NRCGTResidentialProperty', poundsDown(sa.nrcgtResiProperty)),
    el('NRCGTNonResidentialProperty', poundsDown(sa.nrcgtNonResiProperty)),
    flag('NRCGTIndirectDisposals', sa.nrcgtIndirect),
    el('NRCGTTaxCharged', poundsUp(sa.nrcgtTaxCharged)),
    el('NRCGTLosses', poundsUp(sa.nrcgtLosses)),
    // Any other information (boxes 53–54)
    flag('IncludesEstimatesOrValuations', sa.estimatesOrValuations),
    el('OtherInformation', sa.otherInformation),
  ]);
}
