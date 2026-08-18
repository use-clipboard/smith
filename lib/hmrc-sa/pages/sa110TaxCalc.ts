// SA110 — Tax calculation summary. Boxes 1–6 (total tax / NIC / student loan /
// CGT due) are the software's own computation, passed in from computeSa100Full;
// boxes 7–17 are user inputs (PAYE-coding underpayments, payments on account,
// surplus allowances, adjustments). ⚠ Element names PROVISIONAL pending the XSD.

import type { Sa110 } from '@/components/features/tax-studio/types';
import { el, flag, group, money2, poundsDown, poundsUp } from '../xml';

/** The computed SA110 boxes 1–5, derived from computeSa100Full in the assembler. */
export interface Sa110Computed {
  box1: number;            // total tax, Class 2 & 4 NIC due before payments on account
  box2: number;            // total tax overpaid
  studentLoan: number;     // box 3
  class4Nic: number;       // box 4
  capitalGainsTax: number; // box 5
}

export function buildSa110(sa: Sa110 | undefined, computed?: Sa110Computed): string {
  const s = sa ?? {};
  return group('SA110', [
    // Self Assessment — computed boxes 1–6
    el('TotalTaxDue', poundsDown(computed?.box1)),
    el('TotalTaxOverpaid', poundsDown(computed?.box2)),
    el('StudentLoanRepaymentDue', poundsDown(computed?.studentLoan)),
    el('Class4NICsDue', poundsDown(computed?.class4Nic)),
    el('CapitalGainsTaxDue', poundsDown(computed?.capitalGainsTax)),
    // Underpaid tax & other debts (boxes 7–9)
    el('UnderpaidTaxEarlierYears', poundsDown(s.underpaidEarlierYears)),
    el('UnderpaidTaxThisYearNextCode', poundsDown(s.underpaidThisYearNextCode)),
    el('OutstandingDebtInCode', poundsDown(s.outstandingDebtInCode)),
    // Payments on account (boxes 10–11)
    flag('ClaimToReducePaymentsOnAccount', s.claimReducePoa),
    el('FirstPaymentOnAccount', money2(s.firstPoaClaim)),
    // Blind person's / married couple's surplus allowance (boxes 12–13)
    el('BlindSurplusAllowance', poundsUp(s.blindSurplusAllowance)),
    el('MarriedCoupleSurplusAllowance', poundsUp(s.marriedCoupleSurplus)),
    // Adjustments to tax due (boxes 14–16)
    el('IncreaseInTaxDue', poundsDown(s.increaseTaxAdjustment)),
    el('DecreaseInTaxDue', poundsDown(s.decreaseTaxAdjustment)),
    el('LaterYearRepaymentClaimed', poundsDown(s.laterYearRepayment)),
    // Any other information (box 17)
    el('OtherInformation', s.otherInformation),
  ]);
}
