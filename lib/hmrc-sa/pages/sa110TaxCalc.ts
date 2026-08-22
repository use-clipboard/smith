// SA110 — Tax calculation summary.
//
// Validated against HMRC's 2025/26 MTR schema (MTR-v1-2.xsd). Element names and
// nesting are the real schema names. Structure (in order):
//   SA110 → SelfAssessment (req) · UnderpaidTax (req) · PaymentsOnAccount
//         · SurplusAllowances · AdjustmentsToTaxDue · AnyOtherInformationSpace
//
// Boxes 1–5 are the software's own computation (passed in from computeSa100Full
// via the assembler); the rest are user inputs. Two schema groups are REQUIRED:
//   SelfAssessment/TotalTaxEtcDue (1..1) — always emitted, formatted to 2dp even
//     when the tax due is legitimately 0.00.
//   UnderpaidTax (1..1) — always emitted, even when it has no child boxes.

import type { Sa110 } from '@/components/features/tax-studio/types';
import { clip, el, flag, group, moneyDown, moneyUp } from '../xml';

/** The computed SA110 boxes 1–5, derived from computeSa100Full in the assembler. */
export interface Sa110Computed {
  box1: number;            // total tax, Class 2 & 4 NIC due before payments on account
  box2: number;            // total tax overpaid (no home in the 2026 SA110 schema)
  studentLoan: number;     // box 3
  class4Nic: number;       // box 4
  capitalGainsTax: number; // box 5
}

export function buildSa110(sa: Sa110 | undefined, computed?: Sa110Computed): string {
  const s = sa ?? {};

  // ── SelfAssessment (required; TotalTaxEtcDue is mandatory 1..1) ─────────────
  // TotalTaxEtcDue is MTR_SAmonetaryType and must always render — even a genuine
  // nil liability is emitted as "0.00" rather than dropped.
  const box1 = computed?.box1;
  const totalTaxEtcDue = (box1 != null && Number.isFinite(box1) ? Math.floor(box1) : 0).toFixed(2);
  const selfAssessment = group('SelfAssessment', [
    el('TotalTaxEtcDue', totalTaxEtcDue),
    el('StudentLoanRepaymentDue', moneyDown(computed?.studentLoan)),
    el('Class4NICsDue', moneyDown(computed?.class4Nic)),
    el('CapitalGainsTaxDue', moneyDown(computed?.capitalGainsTax)),
  ]);

  // ── UnderpaidTax (required 1..1; every child optional) ─────────────────────
  // Always rendered even when empty, so the mandatory group is present.
  const underpaidInner = [
    el('UnderpaidTaxForEarlierYearsIncludedInCode', moneyDown(s.underpaidEarlierYears)),
    el('UnderpaidTaxForYearIncludedInFutureCode', moneyDown(s.underpaidThisYearNextCode)),
    el('OutstandingDebtCodedOutAmount', moneyDown(s.outstandingDebtInCode)),
  ].join('');
  const underpaidTax = `<UnderpaidTax>${underpaidInner}</UnderpaidTax>`;

  // ── PaymentsOnAccount (optional) ───────────────────────────────────────────
  const paymentsOnAccount = group('PaymentsOnAccount', [
    flag('ClaimToReducePaymentsOnAccount', s.claimReducePoa),
    el('FirstPaymentOnAccount', moneyDown(s.firstPoaClaim)),
  ]);

  // ── SurplusAllowances (optional; non-zero monetary) ────────────────────────
  const surplusAllowances = group('SurplusAllowances', [
    el('SurplusBlindPersonsAllowance', moneyUp(s.blindSurplusAllowance)),
    el('SurplusMarriedCouplesAllowance', moneyUp(s.marriedCoupleSurplus)),
  ]);

  // ── AdjustmentsToTaxDue (optional; non-zero monetary) ──────────────────────
  const adjustments = group('AdjustmentsToTaxDue', [
    el('IncreaseInTaxFromAdjustmentToEarlierYears', moneyDown(s.increaseTaxAdjustment)),
    el('DecreaseInTaxFromAdjustmentToEarlierYears', moneyUp(s.decreaseTaxAdjustment)),
    el('NextYearsRepaymentClaimedNow', moneyUp(s.laterYearRepayment)),
  ]);

  // ── AnyOtherInformationSpace (optional free text, max 20480) ───────────────
  const otherInfo = el('AnyOtherInformationSpace', clip(s.otherInformation, 20480));

  return group('SA110', [
    selfAssessment,
    underpaidTax,
    paymentsOnAccount,
    surplusAllowances,
    adjustments,
    otherInfo,
  ]);
}
