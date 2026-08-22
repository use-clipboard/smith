// SA106 — Foreign. One <SA106> for the return, from income.foreign (Sa106).
//
// Validated against HMRC's 2025/26 MTR schema (MTR-v1-2.xsd). The SA106 element
// is a long xsd:sequence of optional containers: the overseas-income tables
// (OverseasSavings / ForeignCompanies / OverseasPensions / OverseasTrustIncome,
// each a repeatable <IncomeSource> per country), the foreign land & property
// section (<OverseasLandAndPropertyIncomeDetails>, one per property, max 6), the
// foreign loss boxes, <CapitalGains> and <OtherOverseasIncomeAndGains>. Element
// names and order below are the real schema names, not the earlier guesses.
//
// Per-country / per-property detail: the schema's <IncomeSource> requires a
// <CountryCode> (1..1), so the earlier summary-level TODO (summing every country
// into a single figure) cannot render valid XML. We now emit one <IncomeSource>
// per ForeignRow — every column is a real, already-typed field on ForeignRow /
// ForeignProperty, so no data is invented. Rows without a country code are
// dropped (they cannot satisfy the required <CountryCode>).

import type { Sa106, ForeignRow, ForeignProperty } from '@/components/features/tax-studio/types';
import { el, flag, group, moneyDown, moneyUp } from '../xml';

/** MTR_SAcountryCodeType — exactly three uppercase letters ([A-Z]{3}). */
function countryCode(s: string | null | undefined): string | null {
  if (s == null) return null;
  const c = String(s).toUpperCase().replace(/[^A-Z]/g, '');
  return c.length === 3 ? c : null;
}

/** xsd:positiveInteger counts (number of properties / days / years). */
function count(n: number | null | undefined): string | null {
  if (n == null || !Number.isFinite(n)) return null;
  const v = Math.round(n);
  return v > 0 ? String(v) : null;
}

// One <IncomeSource> row (columns A–F). Shared by every overseas-income table:
// all four containers nest the identical child structure, with the taxable
// amount carried in <TaxableAmountOnInterestAndOtherSavings>. The row is dropped
// unless it has a country code (the schema requires <CountryCode>).
function incomeSource(r: ForeignRow): string {
  const cc = countryCode(r.country);
  if (!cc) return '';
  return group('IncomeSource', [
    el('CountryCode', cc),
    el('IncomeBeforeTax', moneyDown(r.incomeArising)),
    el('ForeignTax', moneyUp(r.foreignTax)),
    el('SpecialWithholdingTax', moneyUp(r.specialWithholding)),
    flag('ClaimToFTCR', r.creditRelief),
    // F — taxable amount is computed as the income arising (col B).
    el('TaxableAmountOnInterestAndOtherSavings', moneyDown(r.incomeArising)),
  ]);
}

/** All <IncomeSource> rows for a table (schema caps each at 1..20). */
function incomeSources(rows?: ForeignRow[]): string {
  return (rows ?? []).slice(0, 20).map(incomeSource).join('');
}

// One <OverseasLandAndPropertyIncomeDetails> block (a foreign SA105), populated
// from the fields the tool captures per property.
function propertyDetail(p: ForeignProperty): string {
  return group('OverseasLandAndPropertyIncomeDetails', [
    el('TotalRentsAndOtherPropertyReceipts', moneyDown(p.totalRents)),
    el('AllowablePropertyExpenses', moneyUp(p.expenses)),
    el('CapitalAllowances', moneyUp(p.capitalAllowances)),
    el('ResidentialFinanceCosts', moneyUp(p.residentialFinanceCosts)),
    el('PropertyAbroadCountry', countryCode(p.country)),
    el('PropertyAbroadForeignTax', moneyUp(p.foreignTax)),
    el('PropertyAbroadUKtaxTakenOff', moneyUp(p.ukTax)),
    flag('PropertyAbroadClaimToFTCR', p.creditRelief),
  ]);
}

export function buildSa106(sa: Sa106 | undefined): string {
  if (!sa) return '';

  // ── Foreign land & property (boxes 14–32), one block per property (max 6) ──
  const properties = (sa.properties ?? []).slice(0, 6).map(propertyDetail).join('');

  // ── Capital gains (boxes 33–40) ───────────────────────────────────────────
  const capitalGains = group('CapitalGains', [
    group('ChargeableGainsUKRules', [
      el('ChargeableGains', moneyDown(sa.cgUkGain)),
      el('NumberOfDaysOverWhichGainAccrued', count(sa.cgUkDays)),
    ]),
    group('ChargeableGainsForeignRules', [
      el('ChargeableGains', moneyDown(sa.cgForeignGain)),
      el('NumberOfDaysOverWhichGainAccrued', count(sa.cgForeignDays)),
    ]),
    el('ForeignTaxPaid', moneyUp(sa.cgForeignTax)),
    flag('ForeignTaxCreditReliefClaim', sa.cgClaimFtcr),
    el('TotalForeignTaxCreditReliefOnGains', moneyUp(sa.cgFtcr)),
    el('SpecialWithholdingTax', moneyUp(sa.cgSwt)),
  ]);

  // ── Foreign life insurance gains (boxes 43–45) ────────────────────────────
  const otherIncomeAndGains = group('OtherOverseasIncomeAndGains', [
    el('ForeignLifeInsuranceGains', moneyDown(sa.lifeGains)),
    el('NumberOfYearsSincePolicyMade', count(sa.lifeYears)),
    el('TaxTreatedAsPaid', moneyUp(sa.lifeTaxPaid)),
  ]);

  return group('SA106', [
    // Unremittable income (box 1) + Foreign Tax Credit Relief on income (box 2)
    flag('UnremittableIncome', sa.unremittable),
    el('ForeignTaxCreditRelief', moneyUp(sa.ftcrOnIncome)),
    // Overseas income tables (per country) — order fixed by the schema sequence
    group('OverseasSavings', [incomeSources(sa.interest)]),
    group('ForeignCompanies', [incomeSources(sa.dividends)]),
    group('OverseasPensions', [incomeSources(sa.pensions)]),
    group('OverseasTrustIncome', [incomeSources(sa.otherAll)]),
    // Foreign land & property blocks
    properties,
    // Foreign property losses (boxes 26 & 31)
    el('LossBroughtForward', moneyUp(sa.propLossBroughtForward)),
    el('LossSetOffAgainstTotalIncome', moneyUp(sa.propLossSetOff)),
    // Capital gains + other overseas income & gains
    capitalGains,
    otherIncomeAndGains,
  ]);
}
