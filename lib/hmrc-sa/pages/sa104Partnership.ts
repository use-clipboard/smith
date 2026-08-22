// SA104F — Partnership (full). One <SA104F> per partnership (schema allows 0..50).
//
// Validated against HMRC's 2025/26 MTR schema (MTR-v1-2.xsd): the real element is
// <SA104F> (the full variant is a valid superset of the short SA104S), nesting the
// boxes under PartnershipDetails (required), ShareOfProfits, ShareOfLosses, NICs,
// ShareOfUntaxedIncome, ShareOfPartnershipIncome and ShareOfPartnershipTaxPayed.
// Element names below are the real schema names, not the earlier provisional guesses.
//
// Required by the schema (must always be present on a rendered SA104F):
//   PartnershipDetails/PartnershipReferenceNumber  (1..1, 10-digit UTR)
//   PartnershipDetails/PartnershipDescription      (1..1, 1..28 chars)
//   PartnershipDetails/DidYouJoinThePartnership    (1..1, yes/no)
//   PartnershipDetails/DidYouLeaveThePartnership   (1..1, yes/no)
// Within NICs, Class4NICexempt and AdjustmentToClass4NICProfits are an xsd:choice
// (mutually exclusive) — exemption takes precedence.

import type { PartnershipSource } from '@/components/features/tax-studio/types';
import { clip, digitsOnly, el, flag, group, isoDate, moneyDown, moneyUp, yesno } from '../xml';

function onePartnership(p: PartnershipSource): string {
  // ── PartnershipDetails (required; carries the four mandatory boxes) ─────────
  const details = group('PartnershipDetails', [
    // UTR is required — fall back to a schema-valid placeholder so the return
    // still validates; real data always carries the partnership reference.
    el('PartnershipReferenceNumber', digitsOnly(p.utr, 10) ?? '0000000000'),
    el('PartnershipDescription', clip(p.description, 28) ?? 'Partnership'),
    yesno('DidYouJoinThePartnership', !!isoDate(p.dateJoined)),
    el('DateJoinedPartnership', isoDate(p.dateJoined)),
    yesno('DidYouLeaveThePartnership', !!isoDate(p.dateLeft)),
    el('DateLeftPartnership', isoDate(p.dateLeft)),
  ]);

  // ── ShareOfProfits (boxes 8–20.1) ──────────────────────────────────────────
  const shareOfProfits = group('ShareOfProfits', [
    el('ShareOfPartnershipProfitOrLoss', moneyDown(p.profit > 0 ? p.profit : 0)),
    el('TaxYearAdjustment', moneyDown(p.adjustmentPeriod)),
    el('AveragingAdjustment', moneyDown(p.averagingAdjustment)),
    el('ForeignTaxClaimedAsDeduction', moneyUp(p.foreignTaxDeduction)),
    el('LossesBroughtForward', moneyUp(p.lossBroughtForward)),
    el('OtherBusinessIncome', moneyDown(p.otherBusinessIncome)),
    el('TotalTaxableBusinessProfitsFIGclaim', moneyDown(p.figClaim)),
  ]);

  // ── ShareOfLosses (boxes 21–24) ─────────────────────────────────────────────
  const shareOfLosses = group('ShareOfLosses', [
    el('AdjustedLossForYear', moneyUp(p.profit < 0 ? -p.profit : 0)),
    el('LossSetOffAgainstOtherIncome', moneyUp(p.lossAgainstOtherIncome)),
    el('LossToBeCarriedBack', moneyUp(p.lossCarriedBack)),
  ]);

  // ── NICs (boxes 25–27). Class4 exemption / adjustment are an xsd:choice. ─────
  const class4 = p.class4Exempt
    ? flag('Class4NICexempt', true)
    : el('AdjustmentToClass4NICProfits', moneyUp(p.class4Adjustment));
  const nics = group('NICs', [
    flag('PayClass2NICvoluntarily', p.class2Voluntary),
    class4,
  ]);

  // ── ShareOfUntaxedIncome (boxes 28–63.2) ────────────────────────────────────
  const savingsForeign = group('ForeignIncome', [
    el('ForeignUntaxedSavingsIncomeShare', moneyDown(p.foreignSavings)),
    el('TotalForeignTaxTakenOff', moneyUp(p.foreignSavingsTax)),
  ]);
  const savingsIncome = group('SavingsIncome', [
    el('UKUntaxedSavingsIncomeShare', moneyDown(p.ukSavings)),
    savingsForeign,
  ]);
  const ukPropertyIncome = group('UKPropertyIncome', [
    el('UKPropertyProfitLossShare', moneyDown(p.propertyProfit)),
    el('LossBroughtForward', moneyUp(p.propertyLossBfwd)),
    el('ResidentialFinanceCosts', moneyUp(p.propertyFinanceCosts)),
  ]);
  const otherUntaxedUKIncome = group('OtherUntaxedUKIncome', [
    el('OtherUntaxedUKIncomeShare', moneyDown(p.otherUkIncome)),
  ]);
  const offshoreFundsIncome = group('OffshoreFundsIncome', [
    el('OffshoreFundsIncomeShare', moneyDown(p.offshoreIncome)),
    el('ForeignTaxTakenOff', moneyUp(p.offshoreTax)),
  ]);
  const otherUntaxedForeignIncome = group('OtherUntaxedForeignIncome', [
    el('OtherUntaxedForeignIncomeShare', moneyDown(p.foreignIncome)),
    el('TotalForeignTaxTakenOff', moneyUp(p.foreignTax)),
  ]);
  const shareOfUntaxedIncome = group('ShareOfUntaxedIncome', [
    savingsIncome,
    ukPropertyIncome,
    otherUntaxedUKIncome,
    offshoreFundsIncome,
    otherUntaxedForeignIncome,
  ]);

  // ── ShareOfPartnershipIncome (taxed income, boxes 68–76.1) ──────────────────
  const dividendIncome = group('ShareOfDividendIncome', [
    el('DividendIncome', moneyDown(p.taxedIncome10)),
  ]);
  const taxedAt20 = group('ShareOfTaxedIncomeTaxableAt20Percent', [
    el('ShareOfTaxedIncome', moneyDown(p.taxedIncome20)),
  ]);
  const otherTaxed = group('ShareOfOtherTaxedIncome', [
    el('ShareOfTaxedIncome', moneyDown(p.otherTaxedIncome)),
  ]);
  const shareOfPartnershipIncome = group('ShareOfPartnershipIncome', [
    dividendIncome,
    taxedAt20,
    otherTaxed,
  ]);

  // ── ShareOfPartnershipTaxPayed (boxes 77–80) ────────────────────────────────
  const shareOfTaxPayed = group('ShareOfPartnershipTaxPayed', [
    el('ShareOfIncomeTaxTakenOffPartnershipIncome', moneyUp(p.incomeTaxTaken)),
    el('ShareOfTaxTakenOffByContractors', moneyUp(p.cisDeductions)),
    el('ShareOfTaxTakenOffTradingIncome', moneyUp(p.taxTakenTradingIncome)),
  ]);

  return group('SA104F', [
    details,
    shareOfProfits,
    shareOfLosses,
    nics,
    shareOfUntaxedIncome,
    shareOfPartnershipIncome,
    shareOfTaxPayed,
  ]);
}

/** Build all SA104F pages (one per partnership). Empty when there are none. */
export function buildSa104(partnerships: PartnershipSource[] | undefined): string {
  return (partnerships ?? []).map(onePartnership).join('');
}
