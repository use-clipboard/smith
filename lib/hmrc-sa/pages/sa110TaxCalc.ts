// SA110 — Tax calculation summary. Boxes 7–17 are user inputs (PAYE-coding
// underpayments, payments on account, surplus allowances, adjustments). Boxes
// 1–6 (total tax / NIC / student loan / CGT / pension charges due) are COMPUTED
// from the whole return — TODO(phase1): pass in computeSa100Full(income, taxYear)
// and emit them here (HMRC expects the software's own calc on the SA110).
// ⚠ Element names PROVISIONAL pending the 2025/26 XSD.

import type { Sa110 } from '@/components/features/tax-studio/types';
import { el, flag, group, money2, poundsDown, poundsUp } from '../xml';

export function buildSa110(sa: Sa110 | undefined): string {
  if (!sa) return '';
  return group('SA110', [
    // Underpaid tax & other debts (boxes 7–9)
    el('UnderpaidTaxEarlierYears', poundsDown(sa.underpaidEarlierYears)),
    el('UnderpaidTaxThisYearNextCode', poundsDown(sa.underpaidThisYearNextCode)),
    el('OutstandingDebtInCode', poundsDown(sa.outstandingDebtInCode)),
    // Payments on account (boxes 10–11)
    flag('ClaimToReducePaymentsOnAccount', sa.claimReducePoa),
    el('FirstPaymentOnAccount', money2(sa.firstPoaClaim)),
    // Blind person's / married couple's surplus allowance (boxes 12–13)
    el('BlindSurplusAllowance', poundsUp(sa.blindSurplusAllowance)),
    el('MarriedCoupleSurplusAllowance', poundsUp(sa.marriedCoupleSurplus)),
    // Adjustments to tax due (boxes 14–16)
    el('IncreaseInTaxDue', poundsDown(sa.increaseTaxAdjustment)),
    el('DecreaseInTaxDue', poundsDown(sa.decreaseTaxAdjustment)),
    el('LaterYearRepaymentClaimed', poundsDown(sa.laterYearRepayment)),
    // Any other information (box 17)
    el('OtherInformation', sa.otherInformation),
  ]);
}
