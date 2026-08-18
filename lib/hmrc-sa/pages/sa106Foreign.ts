// SA106 — Foreign. One <SA106> for the return, from income.foreign (Sa106).
//
// ⚠ SUMMARY-LEVEL first pass: the real SA106 lists income PER COUNTRY (each
// ForeignRow = a country with income arising + foreign tax + FTCR claim). Here
// we sum the country tables into category totals so the material figures file,
// and defer the per-country row detail + foreign-property per-property detail to
// the XSD pass. TODO(phase1): emit per-country <Country>/<IncomeArising>/
// <ForeignTax>/<FTCR> rows. Element names PROVISIONAL pending the 2025/26 XSD.

import type { Sa106, ForeignRow, ForeignProperty } from '@/components/features/tax-studio/types';
import { el, flag, group, poundsDown, poundsUp } from '../xml';

const rowsIncome = (rows?: ForeignRow[]) => (rows ?? []).reduce((a, r) => a + (r.incomeArising || 0), 0);
const rowsTax = (rows?: ForeignRow[]) => (rows ?? []).reduce((a, r) => a + (r.foreignTax || 0), 0);
const propSum = (props: ForeignProperty[] | undefined, pick: (p: ForeignProperty) => number | undefined) =>
  (props ?? []).reduce((a, p) => a + (pick(p) || 0), 0);

export function buildSa106(sa: Sa106 | undefined): string {
  if (!sa) return '';
  const props = sa.properties ?? [];
  return group('SA106', [
    // Unremittable income + FTCR on income (boxes 1–2)
    flag('UnremittableIncome', sa.unremittable),
    el('FTCROnIncome', poundsUp(sa.ftcrOnIncome)),
    // Overseas income category totals (summed across countries)
    el('InterestIncome', poundsDown(rowsIncome(sa.interest))),
    el('InterestForeignTax', poundsUp(rowsTax(sa.interest))),
    el('DividendIncome', poundsDown(rowsIncome(sa.dividends))),
    el('DividendForeignTax', poundsUp(rowsTax(sa.dividends))),
    el('PensionIncome', poundsDown(rowsIncome(sa.pensions))),
    el('PensionForeignTax', poundsUp(rowsTax(sa.pensions))),
    el('OtherOverseasIncome', poundsDown(rowsIncome(sa.otherAll))),
    el('OtherOverseasForeignTax', poundsUp(rowsTax(sa.otherAll))),
    // Foreign land & property (boxes 14–24, summed across properties)
    el('ForeignPropertyRents', poundsDown(propSum(props, (p) => p.totalRents))),
    el('ForeignPropertyExpenses', poundsUp(propSum(props, (p) => p.expenses))),
    el('ForeignPropertyCapitalAllowances', poundsUp(propSum(props, (p) => p.capitalAllowances))),
    el('ForeignPropertyResidentialFinanceCosts', poundsUp(propSum(props, (p) => p.residentialFinanceCosts))),
    el('ForeignPropertyLossBroughtForward', poundsDown(sa.propLossBroughtForward)),
    el('ForeignPropertyLossSetOff', poundsDown(sa.propLossSetOff)),
    el('ForeignPropertyForeignTax', poundsUp(propSum(props, (p) => p.foreignTax))),
    // Foreign capital gains (boxes 33–40)
    el('ForeignCGUKGain', poundsDown(sa.cgUkGain)),
    el('ForeignCGForeignGain', poundsDown(sa.cgForeignGain)),
    el('ForeignCGForeignTax', poundsUp(sa.cgForeignTax)),
    flag('ForeignCGClaimFTCR', sa.cgClaimFtcr),
    el('ForeignCGFTCR', poundsUp(sa.cgFtcr)),
    el('ForeignCGSpecialWithholdingTax', poundsUp(sa.cgSwt)),
    // Foreign life insurance gains (boxes 43–46)
    el('ForeignLifeGains', poundsDown(sa.lifeGains)),
    el('ForeignLifeYears', sa.lifeYears),
    el('ForeignLifeTaxPaid', poundsUp(sa.lifeTaxPaid)),
  ]);
}
