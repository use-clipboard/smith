// Tax Studio — SA100 income-tax computation (2025/26, England/Wales/NI).
//
// This is a proper multi-band computation: it applies the personal-allowance
// taper, the savings starting-rate band + personal savings allowance, the
// dividend allowance, band extension for gift aid + pension contributions,
// residential finance-cost relief, Class 4 NIC, student-loan repayments and the
// payments-on-account rules. `computeSa100Full` is the source of truth;
// `estimateSa100`/`estimateNic` are thin adapters kept for lighter surfaces.
//
// Deliberately OUT OF SCOPE (surfaced as notes, not silently ignored): capital
// gains, the High Income Child Benefit Charge, marriage-allowance transfers,
// top-slicing relief, trade-loss relief, Class 2 nuances, and Scottish/Welsh
// rates. Those still require professional review before filing.

import type { Sa100Income, EmploymentSource, TradeSource, PropertySource, PartnershipSource, CgtDisposal, CapitalAllowancesState, PartnershipStatement, ForeignRow, ForeignProperty, Sa106, Sa107, EstateForeignItem, Sa108, MinisterOfReligion, AssemblyOffice, ParliamentOffice, CgtCalcDisposal, CgtCalcState, CgtRelief, CgtOwner } from './types';

/** The taxpayer's ownership share (0–1) of a jointly-owned item. No owners ⇒ 1.
 *  Shared by CGT disposals and joint interest. */
export function ownerShareFraction(owners?: CgtOwner[]): number {
  if (!owners || !owners.length) return 1;
  const tp = owners.find(o => o.isTaxpayer);
  const pct = tp ? (tp.sharePct || 0) : Math.max(0, 100 - owners.reduce((a, o) => a + (o.sharePct || 0), 0));
  return pct / 100;
}

// ── SA107 trusts & estates helper ────────────────────────────────────────────
/** Split trust/estate income by UK treatment. Discretionary trust income is
 *  received net and grossed up at 45% (a fully-creditable tax credit); estate /
 *  interest-in-possession income is reported gross by type with the tax paid.
 *  Amounts are unrounded — round at the call site. */
export function trustTotals(income: Sa100Income): {
  nonSavings: number; savings: number; dividend: number; taxCredit: number;
} {
  let nonSavings = 0, savings = 0, dividend = 0, taxCredit = 0;
  for (const t of income.trusts ?? []) {
    if (t.kind === 'discretionary') {
      const gross = (t.amount || 0) / 0.55; // 45% trust rate
      nonSavings += gross;
      taxCredit += gross - (t.amount || 0);
    } else {
      const amt = t.amount || 0;
      if (t.incomeType === 'savings') savings += amt;
      else if (t.incomeType === 'dividend') dividend += amt;
      else nonSavings += amt;
      taxCredit += t.taxPaid || 0;
    }
  }
  // Fold in the full box-for-box SA107 page (income.sa107) alongside the legacy
  // per-source list, so both feed the computation.
  const s = sa107Totals(income);
  return { nonSavings: nonSavings + s.nonSavings, savings: savings + s.savings, dividend: dividend + s.dividend, taxCredit: taxCredit + s.taxCredit };
}

/** Column totals of the shared "Foreign estate" breakdown (SA107 boxes 22/23/24). */
export function estateForeignTotals(items?: EstateForeignItem[]): { income: number; foreignTax: number; ukTaxWithheld: number } {
  let income = 0, foreignTax = 0, ukTaxWithheld = 0;
  for (const it of items ?? []) { income += it.income || 0; foreignTax += it.foreignTax || 0; ukTaxWithheld += it.ukTaxWithheld || 0; }
  return { income, foreignTax, ukTaxWithheld };
}

/** Split the full SA107 page (income.sa107) by UK treatment, mirroring
 *  `trustTotals`. Discretionary trust income (box 1) is received net of the 45%
 *  trust rate and grossed up (a creditable tax credit); the other "net amount"
 *  boxes are added at their entered value and their explicit tax boxes (15/23/24)
 *  feed the credit. Finer per-rate gross-up of the estate/settlor boxes is left
 *  as entered (deferred), matching how the niche SA106 trust boxes are handled. */
export function sa107Totals(income: Sa100Income): { nonSavings: number; savings: number; dividend: number; taxCredit: number } {
  const s: Sa107 | undefined = income.sa107;
  if (!s) return { nonSavings: 0, savings: 0, dividend: 0, taxCredit: 0 };
  const p = (v?: number) => v || 0;
  let nonSavings = 0, savings = 0, dividend = 0, taxCredit = 0;
  // Discretionary (box 1) — net of 45%, grossed up.
  const discNet = p(s.discretionaryNet);
  if (discNet) { const gross = discNet / 0.55; nonSavings += gross; taxCredit += gross - discNet; }
  // Non-discretionary entitlement (boxes 3–5).
  nonSavings += p(s.nonDiscNonSavings); savings += p(s.nonDiscSavings); dividend += p(s.nonDiscDividend);
  // Income chargeable on settlors (boxes 7–14) — the settlor's own income.
  nonSavings += p(s.settlorNonSavingsBasic) + p(s.settlorNonSavingsTrust) + p(s.settlorNonSavingsGross);
  savings += p(s.settlorSavingsBasic) + p(s.settlorSavingsTrust) + p(s.settlorSavingsGross);
  dividend += p(s.settlorDividend) + p(s.settlorDividendTrust);
  taxCredit += p(s.lifeAssuranceTaxPaid); // box 15
  // UK estates (boxes 16–19).
  nonSavings += p(s.estateNonSavings) + p(s.estateNonSavingsNonRepayable);
  savings += p(s.estateSavings);
  dividend += p(s.estateDividend) + p(s.estateDividend75);
  // Foreign estates (boxes 22–25) + the UK-tax / foreign-tax credits (23/24).
  const fe = estateForeignTotals(s.foreignEstates);
  nonSavings += fe.income + p(s.estateResiPropertyIncome);
  taxCredit += fe.foreignTax + fe.ukTaxWithheld;
  return { nonSavings, savings, dividend, taxCredit };
}

// ── SA104 partnership computed boxes (mirror Capium's blue fields) ────────────
const pnum = (x?: number) => x || 0;

/** box 16 — adjusted profit: share of profit + period / accounting / averaging
 *  adjustments (and any legacy basis-period adjustment) − foreign tax by deduction. */
export function partnershipAdjustedProfit(p: PartnershipSource): number {
  return pnum(p.profit) + pnum(p.adjustmentPeriod) + pnum(p.accountingAdjustment)
    + pnum(p.averagingAdjustment) + pnum(p.adjustments) - pnum(p.foreignTaxDeduction);
}
/** box 18 — taxable profit: adjusted profit + transition profit − losses used. */
export function partnershipTaxableTradeProfit(p: PartnershipSource): number {
  return Math.max(0, partnershipAdjustedProfit(p) + pnum(p.transitionProfit)
    - pnum(p.transitionLossBfwd) - pnum(p.lossBroughtForward));
}
/** box 20 — total taxable profits: taxable profit + other business income. */
export function partnershipTotalTaxableProfit(p: PartnershipSource): number {
  return partnershipTaxableTradeProfit(p) + pnum(p.otherBusinessIncome);
}
/** box 21 — adjusted loss this year (when the adjusted result is negative). */
export function partnershipAdjustedLoss(p: PartnershipSource): number {
  return Math.max(0, -(partnershipAdjustedProfit(p) + pnum(p.transitionProfit)));
}
/** box 24 — total loss to carry forward. */
export function partnershipLossCarryForward(p: PartnershipSource): number {
  return Math.max(0, partnershipAdjustedLoss(p) + pnum(p.lossFigAdjustment)
    - pnum(p.lossAgainstOtherIncome) - pnum(p.lossCarriedBack)) + pnum(p.unusedLossCarriedForward);
}
/** box 30 — adjusted UK savings income. */
export function partnershipAdjustedUkSavings(p: PartnershipSource): number {
  return pnum(p.ukSavings ?? p.savingsInterest) + pnum(p.ukSavingsAdjustment);
}
/** box 34 — adjusted foreign savings income. */
export function partnershipAdjustedForeignSavings(p: PartnershipSource): number {
  return pnum(p.foreignSavings) + pnum(p.foreignSavingsAdjustment);
}
/** box 35 — total untaxed savings income. */
export function partnershipTotalUntaxedSavings(p: PartnershipSource): number {
  return partnershipAdjustedUkSavings(p) + partnershipAdjustedForeignSavings(p);
}
/** box 41 — UK property taxable profit. */
export function partnershipPropertyTaxable(p: PartnershipSource): number {
  return Math.max(0, pnum(p.propertyProfit) + pnum(p.propertyAdjustment) - pnum(p.propertyLossBfwd));
}
/** box 48 — other untaxed UK income taxable profit. */
export function partnershipOtherUkTaxable(p: PartnershipSource): number {
  return Math.max(0, pnum(p.otherUkIncome) + pnum(p.otherUkIncomeAdjustment)
    - pnum(p.otherUkLossBfwd) + pnum(p.otherUkIncomeB));
}
/** box 51 — other untaxed UK income: total loss to carry forward. */
export function partnershipOtherUkLossCarryForward(p: PartnershipSource): number {
  return Math.max(0, -(pnum(p.otherUkIncome) + pnum(p.otherUkIncomeAdjustment) + pnum(p.otherUkIncomeB))
    + pnum(p.otherUkLossAdjustment) + pnum(p.otherUkLossBfwd));
}
/** box 55 — offshore funds taxable profit. */
export function partnershipOffshoreTaxable(p: PartnershipSource): number {
  return Math.max(0, pnum(p.offshoreIncome) + pnum(p.offshoreAdjustment));
}
/** box 60 — other untaxed foreign income taxable profit. */
export function partnershipForeignTaxable(p: PartnershipSource): number {
  return Math.max(0, pnum(p.foreignIncome) + pnum(p.foreignIncomeAdjustment)
    - pnum(p.foreignLossBfwd) + pnum(p.foreignIncomeB));
}
/** box 63 — other untaxed foreign income: total loss to carry forward. */
export function partnershipForeignLossCarryForward(p: PartnershipSource): number {
  return Math.max(0, -(pnum(p.foreignIncome) + pnum(p.foreignIncomeAdjustment) + pnum(p.foreignIncomeB))
    + pnum(p.foreignLossAdjustment) + pnum(p.foreignLossBfwd));
}
/** box 70 — taxed income taxable at 10%. */
export function partnershipTaxedIncome10(p: PartnershipSource): number { return pnum(p.taxedIncome10); }
/** box 73 — taxed income taxable at 20%. */
export function partnershipTaxedIncome20(p: PartnershipSource): number { return pnum(p.taxedIncome20); }
/** box 76 — other taxed income taxable. */
export function partnershipOtherTaxedIncome(p: PartnershipSource): number { return pnum(p.otherTaxedIncome); }
/** box 67 — untaxed income from this business other than that liable at 20% —
 *  the untaxed streams (savings, property, other UK, offshore, foreign). */
export function partnershipUntaxedOther(p: PartnershipSource): number {
  return partnershipTotalUntaxedSavings(p) + partnershipPropertyTaxable(p)
    + partnershipOtherUkTaxable(p) + partnershipOffshoreTaxable(p) + partnershipForeignTaxable(p);
}
/** box 80 — total tax taken off (boxes 77–79), falling back to a legacy figure. */
export function partnershipTaxTakenTotal(p: PartnershipSource): number {
  const boxes = pnum(p.incomeTaxTaken) + pnum(p.cisDeductions) + pnum(p.taxTakenTradingIncome);
  return boxes || pnum(p.taxTaken);
}

// ── SA104 partnership headline ───────────────────────────────────────────────
/** This partner's total taxable trade/professional profit (box 20). */
export function partnershipTaxableProfit(p: PartnershipSource): number {
  return partnershipTotalTaxableProfit(p);
}

// ── Partnership Statement (partner-share allocator) ──────────────────────────
/** Sum of the partners' share percentages (should reach 100). */
export function statementSharesTotal(stmt: PartnershipStatement): number {
  return stmt.partners.reduce((a, p) => a + (Number(p.sharePct) || 0), 0);
}
/** A partner's allocated £ share of the partnership profit. */
export function partnerAllocatedShare(profit: number, sharePct: number): number {
  return Math.round((profit || 0) * (Math.max(0, Math.min(100, sharePct || 0)) / 100));
}
/** The taxpayer partner's allocated £ share — this partner's SA104 box 8. */
export function statementTaxpayerShare(stmt: PartnershipStatement): number {
  const me = stmt.partners.find(p => p.isTaxpayer);
  return me ? partnerAllocatedShare(stmt.profit, me.sharePct) : 0;
}

/** Dividends total — sum of the itemised breakdown when present, else the scalar. */
export function dividendsTotal(income: Sa100Income): number {
  const items = income.dividendItems;
  if (items && items.length) return items.reduce((a, d) => a + (d.amount || 0), 0);
  return income.dividends || 0;
}

/** Untaxed UK interest (box 2) — itemised sum when present, else the scalar. Joint
 *  entries count only the taxpayer's share. */
export function savingsInterestTotal(income: Sa100Income): number {
  const items = income.savingsInterestItems;
  if (items && items.length) return items.reduce((a, s) => a + (s.amount || 0) * ownerShareFraction(s.owners), 0);
  return income.savingsInterest || 0;
}
/** Taxed UK interest (box 1) grossed up: net + tax across the breakdown (taxpayer's share). */
export function taxedInterestGross(income: Sa100Income): number {
  return (income.taxedInterestItems ?? []).reduce((a, t) => a + ((t.net || 0) + (t.tax || 0)) * ownerShareFraction(t.owners), 0);
}
/** Tax deducted at source on taxed UK interest (box 1), taxpayer's share. */
export function taxedInterestTaxCredit(income: Sa100Income): number {
  return (income.taxedInterestItems ?? []).reduce((a, t) => a + (t.tax || 0) * ownerShareFraction(t.owners), 0);
}

// ── Generic itemised line helpers (pensions & other income) ──────────────────
const sumLines = (items?: { amount: number }[]) => (items ?? []).reduce((a, x) => a + (x.amount || 0), 0);
/** Itemised sum when present, else the scalar fallback. */
export function lineTotal(items: { amount: number }[] | undefined, scalar = 0): number {
  return items && items.length ? sumLines(items) : scalar;
}

/** Pension band-extension (TR4 boxes 1–4): relief-at-source (box 1) is grossed
 *  up at 20%; retirement-annuity / employer / overseas payments (boxes 2–4)
 *  extend the band by the amount paid. */
export function pensionBandExtension(income: Sa100Income): number {
  const box1 = lineTotal(income.pensionContributionsItems, income.pensionContributions || 0);
  return box1 * 1.25 + sumLines(income.pensionRetirementAnnuityItems) + sumLines(income.pensionEmployerSchemeItems) + sumLines(income.pensionOverseasItems);
}

/** Net Gift Aid for band extension (TR4 boxes 5, 7, 8): payments in the year
 *  (box 5), less any carried back to the previous year (box 7), plus any
 *  brought back into this year (box 8). Box 6 is a memo subset of box 5. */
export function giftAidNet(income: Sa100Income): number {
  const box5 = lineTotal(income.giftAidItems, income.giftAid || 0);
  const carryBack = sumLines(income.giftAidCarryBackItems);
  const future = sumLines(income.giftAidFutureItems);
  return Math.max(0, box5 - carryBack + future);
}
/** Gifts of qualifying shares/securities (box 9) and land/buildings (box 10) to
 *  charity — relieved as a deduction from total income (modelled as band
 *  extension + a reduction in adjusted net income). */
export function charityAssetGifts(income: Sa100Income): number {
  return sumLines(income.giftAidSharesItems) + sumLines(income.giftAidLandItems);
}

/** Taxable UK pensions & benefits (boxes 8, 9, 11, 13, 15, 16). */
export function pensionsBenefitsTotal(income: Sa100Income): number {
  return lineTotal(income.statePensionItems, income.statePension || 0)
    + sumLines(income.statePensionLumpSumItems)
    + lineTotal(income.pensionsIncomeItems, income.pensionsIncome || 0)
    + (income.incapacityBenefit || 0)
    + (income.jobseekersAllowance || 0)
    + (income.otherPensionsBenefits || 0);
}
/** Tax deducted at source on pensions & benefits (boxes 10, 12, 14). */
export function pensionsBenefitsTaxCredit(income: Sa100Income): number {
  return sumLines(income.statePensionLumpSumTaxItems) + sumLines(income.pensionsIncomeTaxItems) + (income.incapacityBenefitTax || 0);
}
/** Net other UK income: box 17 − box 18 expenses + box 20 pre-owned assets. */
export function otherIncomeNet(income: Sa100Income): number {
  return lineTotal(income.otherIncomeItems, income.otherIncome || 0) - sumLines(income.otherIncomeExpensesItems) + sumLines(income.preOwnedAssetsItems);
}
/** Tax deducted at source on other UK income (box 19). */
export function otherIncomeTaxCredit(income: Sa100Income): number {
  return sumLines(income.otherIncomeTaxItems);
}

// ── SA106 foreign helpers ────────────────────────────────────────────────────
/** Split foreign income by how it's taxed in the UK: interest → savings rates,
 *  dividends → dividend rates, everything else → non-savings. `taxClaimed` /
 *  `incomeClaimed` cover only sources claiming Foreign Tax Credit Relief.
 *  Falls back to the single income/foreignTaxPaid bucket when not itemised. */
export function foreignTotals(income: Sa100Income): {
  interest: number; dividends: number; other: number; taxClaimed: number; incomeClaimed: number;
} {
  const sa = income.foreign;
  const hasNew = !!(sa && (sa.interest?.length || sa.dividends?.length || sa.pensions?.length || sa.remittedExcl?.length
    || sa.remittedDividends?.length || sa.otherDividend?.length || sa.otherAll?.length || sa.properties?.length
    || sa.foreignTaxRows?.length || sa.ftcrOnIncome));
  if (!hasNew) {
    // Legacy path — old itemised sources, or the scalar income/foreignTaxPaid bucket.
    const sources = sa?.sources ?? [];
    if (!sources.length) {
      const inc = sa?.income || 0, tax = sa?.foreignTaxPaid || 0;
      return { interest: 0, dividends: 0, other: inc, taxClaimed: tax, incomeClaimed: inc };
    }
    let interest = 0, dividends = 0, other = 0, taxClaimed = 0, incomeClaimed = 0;
    for (const f of sources) {
      if (f.category === 'interest') interest += f.income;
      else if (f.category === 'dividends') dividends += f.income;
      else other += f.income;
      if (f.claimFtcr !== false) { taxClaimed += f.foreignTaxPaid; incomeClaimed += f.income; }
    }
    return { interest, dividends, other, taxClaimed, incomeClaimed };
  }
  // New SA106 structured path. Interest → savings rates, dividend tables →
  // dividend rates, pensions/remitted/other + foreign property → other income.
  const T = foreignTableTotals;
  const interest = T(sa!.interest).taxable;
  const dividends = T(sa!.dividends).taxable + T(sa!.remittedDividends).taxable + T(sa!.otherDividend).taxable;
  const propTaxable = foreignPropertyTotals(sa).taxableProfit;
  const other = T(sa!.pensions).taxable + T(sa!.remittedExcl).taxable + T(sa!.otherAll).taxable + propTaxable;
  const ftcr = T(sa!.interest).ftcr + T(sa!.dividends).ftcr + T(sa!.remittedDividends).ftcr + T(sa!.otherDividend).ftcr
    + T(sa!.pensions).ftcr + T(sa!.remittedExcl).ftcr + T(sa!.otherAll).ftcr + T(sa!.foreignTaxRows).ftcr + (sa!.ftcrOnIncome || 0);
  return { interest, dividends, other, taxClaimed: ftcr, incomeClaimed: interest + dividends + other };
}

// ── SA106 foreign helpers (country-row tables + foreign property) ────────────
/** B — income arising for a foreign row: its "+" breakdown total when itemised,
 *  else the entered figure. */
export function foreignRowIncome(r: ForeignRow): number {
  return r.breakdown?.length ? r.breakdown.reduce((a, x) => a + (x.grossIncome || 0), 0) : (r.incomeArising || 0);
}
/** C — foreign tax for a foreign row: its breakdown total when itemised, else entered. */
export function foreignRowForeignTax(r: ForeignRow): number {
  return r.breakdown?.length ? r.breakdown.reduce((a, x) => a + (x.foreignTax || 0), 0) : (r.foreignTax || 0);
}
/** F — taxable amount for a foreign income row (= income arising). */
export function foreignRowTaxable(r: ForeignRow): number { return foreignRowIncome(r); }
/** Column totals for a foreign income table: SWT (D), taxable (F), foreign tax
 *  (C) and the FTCR-claimed portion of it. */
export function foreignTableTotals(rows?: ForeignRow[]): { swt: number; taxable: number; foreignTax: number; ftcr: number } {
  let swt = 0, taxable = 0, foreignTax = 0, ftcr = 0;
  for (const r of rows ?? []) {
    swt += r.specialWithholding || 0;
    taxable += foreignRowTaxable(r);
    const ft = foreignRowForeignTax(r);
    foreignTax += ft;
    if (r.creditRelief) ftcr += ft;
  }
  return { swt, taxable, foreignTax, ftcr };
}
const FP_ALLOW = ['capitalAllowances', 'zeroEmissionCar', 'sba', 'electricChargepoint', 'domesticItems'] as const;
/** box 17 — property expenses: "+" breakdown total when itemised, else entered. */
export function foreignPropertyExpenses(p: ForeignProperty): number {
  return p.expenseItems?.length ? p.expenseItems.reduce((a, x) => a + (x.expense || 0), 0) : (p.expenses || 0);
}
/** box 19 — private use adjustment: breakdown total when itemised, else entered. */
export function foreignPropertyPrivateUse(p: ForeignProperty): number {
  return p.expenseItems?.length ? p.expenseItems.reduce((a, x) => a + (x.privateUse || 0), 0) : (p.privateUse || 0);
}
/** box 18 — net profit/loss for a foreign property (allowance replaces expenses). */
export function foreignPropertyNet(p: ForeignProperty): number {
  if ((p.propertyIncomeAllowance || 0) > 0) return (p.totalRents || 0) + (p.premiumsPaid || 0) - (p.propertyIncomeAllowance || 0);
  return (p.totalRents || 0) + (p.premiumsPaid || 0) - foreignPropertyExpenses(p);
}
/** box 24 — adjusted profit (+) or loss (−) for a foreign property. */
export function foreignPropertyAdjusted(p: ForeignProperty): number {
  if ((p.propertyIncomeAllowance || 0) > 0) return foreignPropertyNet(p);
  const allow = FP_ALLOW.reduce((a, k) => a + (p[k] || 0), 0);
  return foreignPropertyNet(p) + foreignPropertyPrivateUse(p) + (p.balancingCharges || 0) - allow;
}
/** Foreign-property section totals: box 25 adjusted, box 27 taxable profit, box 32 loss c/fwd. */
export function foreignPropertyTotals(sa: Sa106 | undefined): { adjusted: number; taxableProfit: number; lossCf: number } {
  const props = sa?.properties ?? [];
  const adjusted = props.reduce((a, p) => a + foreignPropertyAdjusted(p), 0);
  const lossBf = sa?.propLossBroughtForward || 0, lossSetOff = sa?.propLossSetOff || 0;
  return {
    adjusted,
    taxableProfit: Math.max(0, adjusted - lossBf),          // box 27
    lossCf: Math.max(0, Math.max(0, -adjusted) - lossSetOff), // box 32
  };
}

// ── SA102 employment helpers ─────────────────────────────────────────────────
// Total P11D benefits (boxes 9–16); falls back to the legacy aggregate when no
// itemised box is set, so old returns and simple imports still compute.
export function employmentBenefits(e: EmploymentSource): number {
  const d = (e.benCar || 0) + (e.benFuel || 0) + (e.benMedical || 0) + (e.benVouchers || 0)
    + (e.benAssets || 0) + (e.benAccommodation || 0) + (e.benOther || 0) + (e.benExpPayments || 0);
  return d > 0 ? d : (e.benefits || 0);
}
// Total allowable expenses (boxes 17–20); same legacy fallback.
export function employmentExpenses(e: EmploymentSource): number {
  const d = (e.expTravel || 0) + (e.expFixed || 0) + (e.expProfessional || 0) + (e.expOther || 0);
  return d > 0 ? d : (e.expenses || 0);
}
/** Taxable employment income for one job: pay + tips + benefits − expenses (≥0). */
export function employmentTaxable(e: EmploymentSource): number {
  return Math.max(0, e.pay + (e.tips || 0) + employmentBenefits(e) - employmentExpenses(e));
}

// ── SA103F self-employment helpers ───────────────────────────────────────────
const TRADE_EXP_KEYS = [
  'expCostOfGoods', 'expSubcontractors', 'expWages', 'expCarVanTravel', 'expPremises',
  'expRepairs', 'expOffice', 'expAdvertising', 'expInterest', 'expBankCharges',
  'expBadDebts', 'expProfessional', 'expDepreciation', 'expOtherCosts',
] as const;

const TRADE_DISALLOW_KEYS = [
  'disCostOfGoods', 'disSubcontractors', 'disWages', 'disCarVanTravel', 'disPremises',
  'disRepairs', 'disOffice', 'disAdvertising', 'disInterest', 'disBankCharges',
  'disBadDebts', 'disProfessional', 'disDepreciation', 'disOtherCosts',
] as const;
const TRADE_CA_KEYS = [
  'aia', 'ca18', 'ca6', 'zeroEmissionGoods', 'zeroEmissionCar', 'sba', 'sbaFreeport',
  'electricChargepoint', 'enhancedCapitalAllowances', 'allowancesOnSale',
] as const;

/** Total allowable expenses — itemised boxes 17–30 (SA103F box 31). */
export function tradeExpensesTotal(t: TradeSource): number {
  return TRADE_EXP_KEYS.reduce((a, k) => a + (t[k] || 0), 0);
}
/** Total disallowable expenses — itemised boxes 32–45 (box 46); legacy `addBacks`
 *  fallback so older returns still add back their disallowables. */
export function tradeDisallowableTotal(t: TradeSource): number {
  const d = TRADE_DISALLOW_KEYS.reduce((a, k) => a + (t[k] || 0), 0);
  return d > 0 ? d : (t.addBacks || 0);
}
/** Total capital allowances — itemised boxes 49–56 (box 57); legacy fallback. */
export function tradeCapitalAllowancesTotal(t: TradeSource): number {
  const d = TRADE_CA_KEYS.reduce((a, k) => a + (t[k] || 0), 0);
  return d > 0 ? d : ((t.aia || 0) + (t.capitalAllowances || 0));
}
/** True once any income/expense box is used — then net profit is derived. */
export function tradeItemised(t: TradeSource): boolean {
  return (t.turnover || 0) > 0 || (t.otherBusinessIncome || 0) > 0 || tradeExpensesTotal(t) > 0;
}
/** Accounts net profit / (loss) — turnover + other income − expenses (boxes 47/48,
 *  signed); the imported/entered accounts profit when nothing is itemised. */
export function tradeNetProfit(t: TradeSource): number {
  if (!tradeItemised(t)) return t.profit || 0;
  const income = (t.turnover || 0) + (t.otherBusinessIncome || 0);
  // Trading income allowance (box 16.1): deduct up to £1,000 (capped at income)
  // INSTEAD of actual expenses — one or the other, never both.
  if ((t.tradingIncomeAllowance || 0) > 0) return Math.max(0, income - Math.min(t.tradingIncomeAllowance || 0, income));
  return income - tradeExpensesTotal(t);
}
/** Total additions to net profit (box 61): disallowables + balancing charge +
 *  goods for own use. */
export function tradeAdditions(t: TradeSource): number {
  return tradeDisallowableTotal(t) + (t.balancingCharges || 0) + (t.goodsOwnUse || 0);
}
/** Total deductions from net profit (box 63): capital allowances + income
 *  taxable elsewhere. */
export function tradeDeductions(t: TradeSource): number {
  return tradeCapitalAllowancesTotal(t) + (t.incomeReceiptsElsewhere || 0);
}
/** Net business profit / (loss) for tax purposes (boxes 64/65, signed). */
export function tradeProfitForTax(t: TradeSource): number {
  return tradeNetProfit(t) + tradeAdditions(t) - tradeDeductions(t);
}
/** Adjusted profit / (loss) (box 73, signed): profit for tax +/− basis-period,
 *  change-of-practice and averaging adjustments. */
export function tradeAdjustedProfit(t: TradeSource): number {
  return tradeProfitForTax(t) + (t.basisAdjustment || 0) + (t.changeOfPracticeAdjustment || 0) + (t.averagingAdjustment || 0);
}
/** Total taxable profits (box 76, ≥0): adjusted profit less brought-forward loss
 *  set against it, plus any other business income. */
export function tradeTaxableProfit(t: TradeSource): number {
  return Math.max(0, Math.max(0, tradeAdjustedProfit(t)) - (t.lossBroughtForward || 0)) + (t.otherBusinessIncome75 || 0);
}
/** Adjusted loss for the year (box 77, ≥0). */
export function tradeAdjustedLoss(t: TradeSource): number {
  return Math.max(0, -tradeAdjustedProfit(t)) + (t.adjustmentLossFig || 0);
}
/** Loss carried forward (box 80): any brought-forward loss not absorbed by this
 *  year's profit, plus this year's adjusted loss less amounts set sideways / back. */
export function tradeLossCarriedForward(t: TradeSource): number {
  const unusedBroughtForward = Math.max(0, (t.lossBroughtForward || 0) - Math.max(0, tradeAdjustedProfit(t)));
  const thisYear = Math.max(0, tradeAdjustedLoss(t) - (t.lossSetOffOtherIncome || 0) - (t.lossCarriedBack || 0));
  return unusedBroughtForward + thisYear;
}
// ── SA103F balance sheet (display only — not part of the tax computation) ──
export function tradeTotalAssets(t: TradeSource): number {
  return (t.bsEquipment || 0) + (t.bsOtherFixedAssets || 0) + (t.bsStock || 0) + (t.bsDebtors || 0) + (t.bsBank || 0) + (t.bsCash || 0) + (t.bsOtherCurrentAssets || 0);
}
export function tradeTotalLiabilities(t: TradeSource): number {
  return (t.bsCreditors || 0) + (t.bsLoans || 0) + (t.bsOtherLiabilities || 0);
}
export function tradeNetBusinessAssets(t: TradeSource): number { return tradeTotalAssets(t) - tradeTotalLiabilities(t); }
export function tradeCapitalAccountEnd(t: TradeSource): number {
  return (t.caBalanceStart || 0) + tradeNetProfit(t) + (t.caCapitalIntroduced || 0) - (t.caDrawings || 0);
}

// ── Capital allowances calculator (main + special-rate pools, AIA, FYA, WDA) ──
const AIA_LIMIT = 1_000_000;   // Annual Investment Allowance (2025/26)
const WDA_MAIN = 0.18;         // main pool writing-down allowance
const WDA_SPECIAL = 0.06;      // special-rate pool writing-down allowance
const SMALL_POOLS = 1000;      // small-pools write-off threshold

export interface CapitalAllowancesResult {
  aia: number;                 // box 49 — Annual Investment Allowance
  wdaMain: number;             // box 50 — 18% main pool WDA
  wdaSpecial: number;          // box 51 — 6% special-rate WDA
  fya: number;                 // box 55 — 100% first-year / enhanced allowances
  balancingAllowance: number;  // box 56 — allowances on sale / cessation
  balancingCharge: number;     // box 59 — balancing charge on disposals
  total: number;               // box 57 — total capital allowances
  mainPoolCfwd: number;        // TWDV carried forward — main pool
  specialPoolCfwd: number;     // TWDV carried forward — special-rate pool
  // Workings (for the calculator display)
  mainPoolBeforeWda: number;
  specialPoolBeforeWda: number;
  aiaCapped: boolean;
  mainSmallPool: boolean;
  specialSmallPool: boolean;
}

/** Run the capital-allowances computation for one trade's pool state. Pooled
 *  additions/disposals feed the 18%/6% pools; AIA and FYA additions are 100%.
 *  Business-use % restricts AIA/FYA claims (sole traders). Small pools (≤£1,000)
 *  are written off; a pool driven negative by disposals is a balancing charge. */
export function computeCapitalAllowances(state: CapitalAllowancesState | undefined): CapitalAllowancesResult {
  const s = state ?? {};
  const adds = s.additions ?? [];
  const disp = s.disposals ?? [];
  const bus = (pct?: number) => Math.max(0, Math.min(100, pct ?? 100)) / 100;

  // AIA — 100% up to £1m of qualifying spend; business-use restricts the claim.
  const aiaGross = adds.filter(a => a.treatment === 'aia').reduce((t, a) => t + Math.max(0, a.cost || 0), 0);
  const aiaCapped = aiaGross > AIA_LIMIT;
  const aiaScale = aiaCapped && aiaGross > 0 ? AIA_LIMIT / aiaGross : 1;
  const aia = r0(adds.filter(a => a.treatment === 'aia').reduce((t, a) => t + Math.max(0, a.cost || 0) * bus(a.businessUsePct) * aiaScale, 0));

  // FYA — 100% first-year (e.g. zero-emission), business-use restricted.
  const fya = r0(adds.filter(a => a.treatment === 'fya').reduce((t, a) => t + Math.max(0, a.cost || 0) * bus(a.businessUsePct), 0));

  // Pool movements. (Private use on pooled additions is not separately pooled
  // here — use AIA/FYA for private-use assets; noted in the UI.)
  const mainAdds = adds.filter(a => a.treatment === 'main').reduce((t, a) => t + Math.max(0, a.cost || 0), 0);
  const specialAdds = adds.filter(a => a.treatment === 'special').reduce((t, a) => t + Math.max(0, a.cost || 0), 0);
  const mainDisp = disp.filter(d => d.pool === 'main').reduce((t, d) => t + Math.max(0, d.proceeds || 0), 0);
  const specialDisp = disp.filter(d => d.pool === 'special').reduce((t, d) => t + Math.max(0, d.proceeds || 0), 0);

  let mainPool = (s.mainPoolBfwd || 0) + mainAdds - mainDisp;
  let specialPool = (s.specialPoolBfwd || 0) + specialAdds - specialDisp;

  let balancingCharge = 0;
  if (mainPool < 0) { balancingCharge += -mainPool; mainPool = 0; }
  if (specialPool < 0) { balancingCharge += -specialPool; specialPool = 0; }

  const mainSmallPool = mainPool > 0 && mainPool <= SMALL_POOLS;
  const specialSmallPool = specialPool > 0 && specialPool <= SMALL_POOLS;
  const wdaMain = r0(mainSmallPool ? mainPool : mainPool * WDA_MAIN);
  const wdaSpecial = r0(specialSmallPool ? specialPool : specialPool * WDA_SPECIAL);

  const mainPoolCfwd = r0(mainPool - wdaMain);
  const specialPoolCfwd = r0(specialPool - wdaSpecial);
  const balancingAllowance = 0; // cessation balancing allowances not modelled here

  const total = aia + fya + wdaMain + wdaSpecial + balancingAllowance;
  return {
    aia, wdaMain, wdaSpecial, fya, balancingAllowance, balancingCharge: r0(balancingCharge), total,
    mainPoolCfwd, specialPoolCfwd, mainPoolBeforeWda: r0(mainPool), specialPoolBeforeWda: r0(specialPool),
    aiaCapped, mainSmallPool, specialSmallPool,
  };
}
// Legacy aliases kept for callers that used the pre-itemised names.
export function tradeCapitalAllowances(t: TradeSource): number { return tradeCapitalAllowancesTotal(t); }
export function tradeAddBacks(t: TradeSource): number { return tradeAdditions(t); }

// ── SA105 property helpers ───────────────────────────────────────────────────
const PROP_EXP_KEYS = ['expPremises', 'expRepairs', 'expLoanInterest', 'expProfessional', 'expServices', 'expOther'] as const;
const PROP_ALLOWANCE_KEYS = ['aia', 'sba', 'electricChargepoint', 'freeportSba', 'zeroEmissionCar', 'capitalAllowances', 'domesticItems'] as const;

export function propertyExpensesTotal(p: PropertySource): number {
  return PROP_EXP_KEYS.reduce((a, k) => a + (p[k] || 0), 0);
}
/** Capital allowances + reliefs deducted in the taxable-profit section (32–36). */
export function propertyAllowancesTotal(p: PropertySource): number {
  return PROP_ALLOWANCE_KEYS.reduce((a, k) => a + (p[k] || 0), 0);
}
/** box 20 + 22 + 23 — total property income before expenses. */
export function propertyGrossIncome(p: PropertySource): number {
  return (p.rents || 0) + (p.premiums || 0) + (p.reversePremiums || 0);
}
export function propertyItemised(p: PropertySource): boolean {
  return propertyGrossIncome(p) > 0 || propertyExpensesTotal(p) > 0;
}
/** Net rental profit before tax adjustments — gross income − expenses when
 *  itemised, else the imported/entered accounts profit. */
export function propertyNetProfit(p: PropertySource): number {
  return propertyItemised(p) ? propertyGrossIncome(p) - propertyExpensesTotal(p) : (p.profit || 0);
}
/** Adjusted result for the year (+ = box 38 profit, − = box 41 loss). When the
 *  property income allowance is claimed it replaces actual expenses/allowances. */
export function propertyAdjustedResult(p: PropertySource): number {
  const rentARoom = p.rentARoomExempt ?? p.rentARoom ?? 0;
  if ((p.propertyIncomeAllowance || 0) > 0) return propertyGrossIncome(p) - (p.propertyIncomeAllowance || 0);
  return propertyNetProfit(p) + (p.privateUse || 0) + (p.balancingCharges || 0)
    - propertyAllowancesTotal(p) - rentARoom;
}
/** box 38 — adjusted profit for the year (nil in a loss year). */
export function propertyAdjustedProfit(p: PropertySource): number {
  return Math.max(0, propertyAdjustedResult(p));
}
/** box 41 — adjusted loss for the year (nil in a profit year). */
export function propertyAdjustedLoss(p: PropertySource): number {
  return Math.max(0, -propertyAdjustedResult(p));
}
/** box 40 — taxable profit: adjusted profit less brought-forward loss used.
 *  Property losses carry forward; they are not relieved sideways. */
export function propertyTaxable(p: PropertySource): number {
  return Math.max(0, propertyAdjustedProfit(p) - (p.lossBroughtForward || 0));
}
/** The TAXPAYER's share of a property's taxable profit. Income and expenses are
 *  entered WHOLE and scaled by the ownership fraction, but the £1,000 property
 *  income allowance is PER-PERSON (HMRC) — so when it's claimed we apply the
 *  taxpayer's own allowance against their share of the gross income, rather than
 *  scaling the whole (which would give them only their fraction of £1,000). */
export function propertyTaxableShare(p: PropertySource): number {
  const share = ownerShareFraction(p.owners);
  if ((p.propertyIncomeAllowance || 0) > 0) {
    return Math.max(0, Math.round(propertyGrossIncome(p) * share) - (p.propertyIncomeAllowance || 0));
  }
  return Math.round(propertyTaxable(p) * share);
}
/** The taxpayer's share of a property's residential finance costs (box 44). */
export function propertyFinanceShare(p: PropertySource): number {
  return (p.residentialFinanceCosts || 0) * ownerShareFraction(p.owners);
}
/** box 43 — loss to carry forward: this year's loss + unused b/fwd − loss set off. */
export function propertyLossCarryForward(p: PropertySource): number {
  return Math.max(0, propertyAdjustedLoss(p) + (p.unusedLossCarriedForward || 0) - (p.lossSetOffTotalIncome || 0));
}

// ── SA108 capital-gains helpers ──────────────────────────────────────────────
/** Chargeable gain (after reliefs) and allowable loss for one disposal. */
export function disposalGainLoss(d: CgtDisposal): { gain: number; loss: number } {
  const raw = (d.proceeds || 0) - (d.cost || 0);
  if (raw > 0) return { gain: Math.max(0, raw - (d.reliefs || 0)), loss: 0 };
  return { gain: 0, loss: -raw };
}

/** Roll up the box-for-box SA108 page into the figures the CGT computation
 *  needs: standard-rated gains, BADR/ER gains (box 50, taxed at 14% — carved out
 *  of the category gains), in-year losses (all categories) and brought-forward
 *  losses used (box 45). Used only when there's no per-disposal working list. */
export function sa108Gains(s: Sa108): { normalGains: number; badrGains: number; inYearLosses: number; broughtForwardUsed: number } {
  const p = (v?: number) => v || 0;
  const gains = p(s.resiGains) + p(s.cryptoGains) + p(s.otherGains) + p(s.listedGains) + p(s.unlistedGains);
  const badrGains = Math.min(gains, p(s.badrGains));
  const inYearLosses = p(s.resiLosses) + p(s.cryptoLosses) + p(s.otherLosses) + p(s.listedLosses) + p(s.unlistedLosses);
  return { normalGains: Math.max(0, gains - badrGains), badrGains, inYearLosses, broughtForwardUsed: p(s.lossesBfUsed) };
}
/** True once any SA108 gain/loss box carries a figure. */
export function sa108HasData(s?: Sa108): boolean {
  if (!s) return false;
  const g = sa108Gains(s);
  return g.normalGains > 0 || g.badrGains > 0 || g.inYearLosses > 0 || g.broughtForwardUsed > 0;
}

// ── CGT calculator ────────────────────────────────────────────────────────────
export const CGT_AEA = 3000;               // 2025/26 annual exempt amount
export const BADR_LIFETIME_LIMIT = 1_000_000;
const cgtNum = (v?: number) => v || 0;

/** The taxpayer's ownership share of a disposal (%). No owners ⇒ sole owner. */
export function cgtTaxpayerShare(d: CgtCalcDisposal): number {
  return ownerShareFraction(d.owners) * 100;
}
/** Whole-asset gain before reliefs (proceeds − all allowable costs); may be a loss. */
export function cgtGrossGain(d: CgtCalcDisposal): number {
  return cgtNum(d.proceeds) - (cgtNum(d.acquisitionCost) + cgtNum(d.incidentalCosts) + cgtNum(d.improvementCosts));
}
/** Total accepted gain-reducing reliefs (BADR is a rate, not a reducer, so excluded). */
export function cgtAcceptedReliefs(d: CgtCalcDisposal): number {
  return (d.reliefs ?? []).filter(r => r.accepted && r.kind !== 'badr').reduce((a, r) => a + cgtNum(r.amount), 0);
}
/** Whole-asset net gain after reliefs (reliefs never turn a gain into a loss, and
 *  don't apply to a loss disposal). Signed: negative = loss. */
export function cgtNetGainWhole(d: CgtCalcDisposal): number {
  const g = cgtGrossGain(d);
  return g <= 0 ? g : Math.max(0, g - cgtAcceptedReliefs(d));
}
/** The taxpayer's signed share of the net gain / (loss). */
export function cgtTaxpayerGain(d: CgtCalcDisposal): number {
  return Math.round(cgtNetGainWhole(d) * cgtTaxpayerShare(d) / 100);
}

/** Rules-based relief suggestions for a disposal (whole-asset amounts). */
export function cgtSuggestReliefs(d: CgtCalcDisposal): { kind: CgtRelief['kind']; label: string; amount: number; note: string }[] {
  const out: { kind: CgtRelief['kind']; label: string; amount: number; note: string }[] = [];
  const gross = cgtGrossGain(d);
  if (gross <= 0) return out; // no reliefs on a loss
  if (d.assetClass === 'residential' && d.wasMainResidence) {
    const own = cgtNum(d.ownershipMonths), occ = cgtNum(d.occupationMonths);
    if (own > 0) {
      const qualifying = Math.min(own, occ + Math.min(9, Math.max(0, own - occ))); // + final 9 months
      const prr = Math.round(gross * qualifying / own);
      if (prr > 0) out.push({ kind: 'prr', label: 'Private Residence Relief', amount: prr, note: `Main home for ${occ} of ${own} months (plus the final 9 months) — ${qualifying}/${own} of the gain is exempt.` });
      if (d.wasLet && prr < gross) {
        const lettingGain = gross - prr;
        const lettings = Math.min(prr, 40000, lettingGain);
        if (lettings > 0) out.push({ kind: 'lettings', label: 'Letting Relief', amount: lettings, note: 'May apply where you shared the home with a tenant. Restricted since April 2020 to periods of shared occupancy — confirm eligibility.' });
      }
    }
  }
  if (d.claimBadr && (d.assetClass === 'unlisted' || d.assetClass === 'other')) {
    out.push({ kind: 'badr', label: 'Business Asset Disposal Relief (14%)', amount: 0, note: 'Taxed at 14% instead of 20/24%, up to the £1m lifetime limit — needs a 2-year qualifying period (5%+ shareholding & officer/employee for shares).' });
  }
  return out;
}

export interface CgtCalcSummary {
  byClass: Record<string, { disposals: number; proceeds: number; costs: number; gains: number; losses: number }>;
  totalGains: number; totalLosses: number; badrGains: number;
  lossesInYearUsed: number; lossesBfAvailable: number; lossesBfUsed: number; lossesCarriedForward: number;
  taxableGains: number; estCgt: number; badrLifetimeRemaining: number;
}
const CGT_CLASSES = ['residential', 'crypto', 'listed', 'unlisted', 'other'] as const;

/** Total a calculator working: aggregate disposals into per-class figures, auto-
 *  allocate losses (in-year first, then brought-forward down to the AEA) and
 *  carry the rest forward, and estimate the CGT. */
export function cgtCalcSummary(state?: CgtCalcState): CgtCalcSummary {
  const byClass: CgtCalcSummary['byClass'] = {};
  for (const c of CGT_CLASSES) byClass[c] = { disposals: 0, proceeds: 0, costs: 0, gains: 0, losses: 0 };
  let badrGains = 0;
  for (const d of state?.disposals ?? []) {
    const share = cgtTaxpayerShare(d) / 100;
    const b = byClass[d.assetClass] ?? byClass.other;
    b.disposals += 1;
    b.proceeds += Math.round(cgtNum(d.proceeds) * share);
    b.costs += Math.round((cgtNum(d.acquisitionCost) + cgtNum(d.incidentalCosts) + cgtNum(d.improvementCosts)) * share);
    const g = cgtTaxpayerGain(d);
    if (g >= 0) { b.gains += g; if (d.claimBadr) badrGains += g; } else b.losses += -g;
  }
  const totalGains = CGT_CLASSES.reduce((a, c) => a + byClass[c].gains, 0);
  const totalLosses = CGT_CLASSES.reduce((a, c) => a + byClass[c].losses, 0);
  const lossesBfAvailable = cgtNum(state?.lossesBroughtForward);
  const netInYear = totalGains - totalLosses;
  let lossesInYearUsed = 0, lossesBfUsed = 0, taxableGains = 0, lossesCarriedForward = 0;
  if (netInYear <= 0) {
    lossesInYearUsed = totalGains;
    lossesCarriedForward = (totalLosses - totalGains) + lossesBfAvailable;
  } else {
    lossesInYearUsed = totalLosses;
    const bfNeeded = Math.max(0, netInYear - CGT_AEA);
    lossesBfUsed = Math.min(lossesBfAvailable, bfNeeded);
    taxableGains = Math.max(0, netInYear - lossesBfUsed - CGT_AEA);
    lossesCarriedForward = lossesBfAvailable - lossesBfUsed;
  }
  const badrLifetimeRemaining = Math.max(0, BADR_LIFETIME_LIMIT - cgtNum(state?.badrLifetimeUsed));
  const badrTaxable = Math.min(taxableGains, Math.min(badrGains, badrLifetimeRemaining));
  const estCgt = Math.round(badrTaxable * 0.14 + (taxableGains - badrTaxable) * 0.24); // higher-rate estimate
  return { byClass, totalGains, totalLosses, badrGains, lossesInYearUsed, lossesBfAvailable, lossesBfUsed, lossesCarriedForward, taxableGains, estCgt, badrLifetimeRemaining };
}

/** Merge a scenario's CGT working into the main return when "pushing to the main
 *  return": 'replace' takes the scenario as-is; 'add' appends the scenario's
 *  disposals to the main working (keeping the main return's losses/BADR settings). */
export function mergeCgtCalcForPush(main: CgtCalcState | undefined, scenario: CgtCalcState | undefined, mode: 'replace' | 'add'): CgtCalcState {
  const sc = scenario ?? {};
  if (mode === 'replace' || !main) return { ...sc };
  return { ...main, disposals: [...(main.disposals ?? []), ...(sc.disposals ?? [])] };
}

/** Write a calculator working into the SA108 boxes (the auto-total to the form). */
export function cgtCalcToSa108(state: CgtCalcState | undefined, existing?: Sa108): Sa108 {
  const s = cgtCalcSummary(state);
  const set = (v: number) => (v ? Math.round(v) : undefined);
  const badrApplied = Math.min(s.badrGains, s.badrLifetimeRemaining);
  return {
    ...existing,
    resiDisposals: set(s.byClass.residential.disposals), resiProceeds: set(s.byClass.residential.proceeds), resiCosts: set(s.byClass.residential.costs), resiGains: set(s.byClass.residential.gains), resiLosses: set(s.byClass.residential.losses),
    cryptoDisposals: set(s.byClass.crypto.disposals), cryptoProceeds: set(s.byClass.crypto.proceeds), cryptoCosts: set(s.byClass.crypto.costs), cryptoGains: set(s.byClass.crypto.gains), cryptoLosses: set(s.byClass.crypto.losses),
    otherDisposals: set(s.byClass.other.disposals), otherProceeds: set(s.byClass.other.proceeds), otherCosts: set(s.byClass.other.costs), otherGains: set(s.byClass.other.gains), otherLosses: set(s.byClass.other.losses),
    listedDisposals: set(s.byClass.listed.disposals), listedProceeds: set(s.byClass.listed.proceeds), listedCosts: set(s.byClass.listed.costs), listedGains: set(s.byClass.listed.gains), listedLosses: set(s.byClass.listed.losses),
    unlistedDisposals: set(s.byClass.unlisted.disposals), unlistedProceeds: set(s.byClass.unlisted.proceeds), unlistedCosts: set(s.byClass.unlisted.costs), unlistedGains: set(s.byClass.unlisted.gains), unlistedLosses: set(s.byClass.unlisted.losses),
    lossesBfUsed: set(s.lossesBfUsed), lossesCarriedForward: set(s.lossesCarriedForward),
    badrGains: set(s.badrGains), badrLifetimeClaimed: set(cgtNum(state?.badrLifetimeUsed) + badrApplied),
  };
}

// ── SA101 additional-information helper ──────────────────────────────────────
/** Total SA101 income-tax reducers: EIS/SEIS/VCT/CITR subscriptions + capped
 *  maintenance relief. Unrounded — round at the call site. */
export function additionalReliefs(income: Sa100Income): number {
  const a = income.additional;
  if (!a) return 0;
  return (a.eisSubscriptions || 0) * EIS_RATE + (a.seisSubscriptions || 0) * SEIS_RATE
    + (a.vctSubscriptions || 0) * VCT_RATE + (a.citrInvestment || 0) * CITR_RATE
    + Math.min(a.maintenancePayments || 0, MAINTENANCE_CAP) * MAINTENANCE_RATE;
}

/** SA101 extra income + tax credits that flow into the SA100 computation:
 *  non-savings (life-insurance gains without a credit, voided-ISA gains, business
 *  receipts, share-scheme & employment lump-sum amounts), dividend-type income
 *  (stock dividends, bonus issues, close-company loans written off), and the tax
 *  already taken off (voided-ISA tax, tax off the lump sums). The box-4 life gain
 *  + its 20% credit are handled separately (chargeableEventGains). Niche pension /
 *  loss / annual-payment boxes are captured on the page but not applied here. */
export function sa101ExtraIncome(income: Sa100Income): { nonSavings: number; dividends: number; taxDeducted: number } {
  const a = income.additional;
  if (!a) return { nonSavings: 0, dividends: 0, taxDeducted: 0 };
  const nonSavings = (a.lifeGainNoTaxPaid || 0) + (a.voidedIsaGain || 0) + (a.businessReceipts || 0)
    + (a.shareSchemesTaxable || 0) + (a.taxableLumpSums || 0) + (a.efrbsBenefits || 0) + (a.redundancyReceipts || 0);
  const dividends = (a.stockDividends || 0) + (a.bonusIssues || 0) + (a.closeCompanyLoansWrittenOff || 0);
  const taxDeducted = (a.voidedIsaTax || 0) + (a.taxOffLumpSums || 0);
  return { nonSavings, dividends, taxDeducted };
}

// ── SA102M Ministry of religion ──────────────────────────────────────────────
export interface MinisterComputed {
  box12: number; box19: number; box20: number; box26: number; box27: number;
  box31: number; box32: number; box34: number; box35: number; box38: number; box39: number;
  taxable: number; taxDeducted: number;
}
/** The SA102M computed ("blue") boxes + the taxable income / tax credit it feeds
 *  into the SA100. The service-benefit-cap boxes (34/35) are a best-effort
 *  working figure — review before filing. */
export function ministerComputed(m?: MinisterOfReligion): MinisterComputed {
  const n = (v?: number) => v || 0;
  const box12 = n(m?.salary) + n(m?.feesOfferings) + n(m?.vicarageExpensesPaid) + n(m?.personalExpenses) + n(m?.excessMileage) + n(m?.roundSumExpenses) + n(m?.otherIncome);
  const box19 = n(m?.vicarageServicesBenefit) + n(m?.carBenefit) + n(m?.carFuelBenefit) + n(m?.loansBenefit) + n(m?.expensesReceived) + n(m?.otherBenefits);
  const box20 = box12 + box19;
  const box26 = n(m?.travellingExpenses) + n(m?.manseMaintenance) + n(m?.rent) + n(m?.secretarialAssistance) + n(m?.otherExpenses);
  const box27 = box20;
  const box31 = box27 + n(m?.backPayAfterApril) + n(m?.earlierYearBackPay) - box26 - n(m?.pensionPayments);
  const box32 = Math.round(box31 * 0.10);
  const box34 = n(m?.amountPaidTowardBenefit) + n(m?.vicarageServicesBenefit);
  const box35 = Math.max(0, box34 - box32);
  const box38 = Math.max(0, box31 + n(m?.chaplaincyIncome));
  const box39 = m?.totalTaxTakenOff != null && m.totalTaxTakenOff > 0
    ? m.totalTaxTakenOff
    : n(m?.taxOffSalary) + n(m?.taxOffRoundSum) + n(m?.taxOffOtherIncome) + n(m?.taxOffChaplaincy);
  return { box12, box19, box20, box26, box27, box31, box32, box34, box35, box38, box39, taxable: box38, taxDeducted: box39 };
}
/** True if any minister-of-religion box carries a value. */
export function ministerHasData(m?: MinisterOfReligion): boolean {
  if (!m) return false;
  return Object.values(m).some(v => (typeof v === 'number' ? v !== 0 : !!(v && String(v).trim())));
}

export interface AssemblyComputed {
  income: number;    // box 1 — pay from office
  benefits: number;  // boxes 3+4+5+6 — office benefits
  expenses: number;  // boxes 7+8+9 — office expenses paid personally
  taxable: number;   // pay + benefits − expenses (floored at 0)
  taxDeducted: number; // box 2 — tax taken off the office pay
}
/** SA102 devolved-legislature office schedule: taxable emoluments are pay from
 *  office plus office benefits/reimbursements, less the office expenses the member
 *  paid personally. Box 1.1 is a sub-figure of box 1, so it is not added again. */
export function assemblyComputed(a?: AssemblyOffice): AssemblyComputed {
  const n = (v?: number) => v || 0;
  const income = n(a?.p60Pay);
  const benefits = n(a?.officeCostExpenditure) + n(a?.otherCashReimbursements) + n(a?.allOtherBenefits) + n(a?.balancingCharges);
  const expenses = n(a?.secretarialAssistance) + n(a?.officeExpenses) + n(a?.otherExpensesCapitalAllowances);
  const taxable = Math.max(0, income + benefits - expenses);
  return { income, benefits, expenses, taxable, taxDeducted: n(a?.taxTakenOff) };
}
/** True if any assembly-office box carries a value (incl. the free-text note). */
export function assemblyHasData(a?: AssemblyOffice): boolean {
  if (!a) return false;
  return Object.values(a).some(v => (typeof v === 'number' ? v !== 0 : !!(v && String(v).trim())));
}

export interface ParliamentComputed {
  income: number;    // box 1 — pay from office
  benefits: number;  // boxes 3–9 — office benefits
  expenses: number;  // boxes 10–13 — office expenses paid personally
  taxable: number;   // pay + benefits − expenses (floored at 0)
  taxDeducted: number; // box 2 — tax taken off the office pay
}
/** SA102 MPs office schedule: taxable emoluments are pay from office plus office
 *  benefits/reimbursements, less the office expenses the member paid personally.
 *  Box 1.1 is a sub-figure of box 1, so it is not added again. */
export function parliamentComputed(m?: ParliamentOffice): ParliamentComputed {
  const n = (v?: number) => v || 0;
  const income = n(m?.p60Pay);
  const benefits = n(m?.travelVouchers) + n(m?.accommodation) + n(m?.officeCostsExpenditure) + n(m?.contingencyPayment) + n(m?.financialAssistanceFund) + n(m?.allOtherBenefits) + n(m?.balancingCharges);
  const expenses = n(m?.travelWarrants) + n(m?.secretarialAssistance) + n(m?.officeExpenses) + n(m?.otherExpensesCapitalAllowances);
  const taxable = Math.max(0, income + benefits - expenses);
  return { income, benefits, expenses, taxable, taxDeducted: n(m?.taxTakenOff) };
}
/** True if any MPs-office box carries a value (incl. the free-text note). */
export function parliamentHasData(m?: ParliamentOffice): boolean {
  if (!m) return false;
  return Object.values(m).some(v => (typeof v === 'number' ? v !== 0 : !!(v && String(v).trim())));
}

// ── 2025/26 parameters ───────────────────────────────────────────────────────
const PA = 12570;
const PA_TAPER_THRESHOLD = 100000;
const BASIC_RATE_LIMIT = 37700;
const ADDITIONAL_THRESHOLD = 125140;

const R_BASIC = 0.20, R_HIGHER = 0.40, R_ADDITIONAL = 0.45;

const SAVINGS_STARTING_BAND = 5000;
const PSA_BASIC = 1000, PSA_HIGHER = 500;

const DIV_ALLOWANCE = 500;
const DIV_BASIC = 0.0875, DIV_HIGHER = 0.3375, DIV_ADDITIONAL = 0.3935;

const NIC_LPL = 12570, NIC_UPL = 50270;
const C4_MAIN = 0.06, C4_UPPER = 0.02;
const C1_MAIN = 0.08, C1_UPPER = 0.02; // employee Class 1 (planning only)

const FINANCE_RELIEF = 0.20;
const MARRIAGE_ALLOWANCE_TRANSFER = 1260; // PA reduction for the transferor
const MARRIAGE_ALLOWANCE_REDUCER = 252;   // ~10% of PA @ 20% for the recipient

// Capital gains — 2025/26 main rates (residential & other assets both 18%/24%).
const CGT_ANNUAL_EXEMPT = 3000;
const CGT_LOWER = 0.18;
const CGT_HIGHER = 0.24;
const CGT_BADR = 0.14; // Business Asset Disposal Relief / Investors' Relief (2025/26)
// SA101 venture-capital / other relief rates
const EIS_RATE = 0.30, SEIS_RATE = 0.50, VCT_RATE = 0.30, CITR_RATE = 0.05;
const MAINTENANCE_CAP = 4010, MAINTENANCE_RATE = 0.10;

// Scottish rates 2025/26 — NSND income only, as band WIDTHS of taxable income
// (post personal allowance). The basic band widens by grossed reliefs.
const SCOT_BANDS: { key: string; width: number; rate: number }[] = [
  { key: 'starter',      width: 2827,     rate: 0.19 },
  { key: 'basic',        width: 12094,    rate: 0.20 },
  { key: 'intermediate', width: 16171,    rate: 0.21 },
  { key: 'higher',       width: 31338,    rate: 0.42 },
  { key: 'advanced',     width: 50140,    rate: 0.45 },
  { key: 'top',          width: Infinity, rate: 0.48 },
];

// High Income Child Benefit Charge — 2025/26 clawback £60k → £80k (1% per £200).
const HICBC_THRESHOLD = 60000;
const HICBC_STEP = 200;

const SL_THRESHOLDS: Record<1 | 2 | 4 | 5, number> = { 1: 26065, 2: 28470, 4: 32745, 5: 25000 };
const SL_RATE = 0.09;
const PGL_THRESHOLD = 21000; // Postgraduate Loan repayment threshold
const PGL_RATE = 0.06;
const BLIND_PERSONS_ALLOWANCE = 3130; // 2025/26 — added to the personal allowance
const WFP_CHARGE_THRESHOLD = 35000;   // Winter Fuel Payment / PAWHP full recovery above this ANI

type Band = 'basic' | 'higher' | 'additional';

export interface TaxLine {
  label: string;
  band: Band | 'starting' | 'allowance';
  amount: number;
  rate: number;
  tax: number;
}

// Legacy shape kept for existing consumers (list cards, approval pack, etc.).
export interface TaxBandLine { label: string; amount: number; rate: number; tax: number; }
export interface TaxEstimate {
  taxYear: string;
  totalIncome: number;
  nonDividendIncome: number;
  dividendIncome: number;
  personalAllowance: number;
  taxableIncome: number;
  bands: TaxBandLine[];
  incomeTax: number;
  dividendTax: number;
  taxDeductedAtSource: number;
  totalTax: number;          // total liability (income tax + NIC + student loan)
  balancingPayment: number;
  paymentOnAccount: number;
  effectiveRate: number;
}

export interface Sa100Computation {
  taxYear: string;
  employmentIncome: number;
  tradeProfit: number;
  partnershipProfit: number;
  propertyProfit: number;
  savingsIncome: number;
  dividendIncome: number;
  otherIncome: number;
  otherIncomeParts: { label: string; amount: number }[]; // sub-components that make up otherIncome
  totalIncome: number;

  personalAllowance: number;
  paTapered: boolean;
  charityAssetGiftsDeduction: number; // gifts of shares/land to charity (boxes 9–10)
  taxableNonSavings: number;
  taxableSavings: number;
  taxableDividends: number;
  taxableIncome: number;

  lines: TaxLine[];
  incomeTaxBeforeReducers: number;
  financeCostReducer: number;
  marriageAllowanceReducer: number;
  foreignTaxCreditRelief: number;
  additionalReliefs: number;
  incomeTax: number;         // after reducers, not below zero

  class4Nic: number;
  studentLoan: number;
  hicbc: number;             // High Income Child Benefit Charge
  taxableGains: number;      // after losses + annual exempt amount
  capitalGainsTax: number;
  totalDue: number;          // incomeTax + class4Nic + studentLoan + HICBC + CGT

  taxDeductedAtSource: number;
  balancingPayment: number;
  paymentOnAccount: number;  // each of two, 0 when POA doesn't apply
  poaApplies: boolean;

  effectiveRate: number;
  marginalBand: Band;
  notes: string[];
}

function sum(ns: number[]): number { return ns.reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0); }
function r0(n: number): number { return Math.round(n); }

/** Split `amount` starting at income position `used` across the extended bands. */
function placeInBands(amount: number, used: number, brl: number, addl: number): Record<Band, number> {
  const basic = Math.min(amount, Math.max(0, brl - used));
  const afterBasic = amount - basic;
  const higher = Math.min(afterBasic, Math.max(0, addl - Math.max(used, brl)));
  const additional = afterBasic - higher;
  return { basic, higher, additional };
}

export function computeSa100Full(income: Sa100Income, taxYear = '2025/26'): Sa100Computation {
  const notes: string[] = [];

  const employmentIncome = sum(income.employment.map(employmentTaxable));
  const taxDeducted = sum(income.employment.map(e => e.taxDeducted));
  // Per-trade taxable profit (SA103F box 76): net profit + additions (disallowables,
  // balancing charge, goods for own use) − deductions (capital allowances, income
  // taxable elsewhere) +/− basis/practice/averaging adjustments, less brought-forward
  // loss, plus other business income. Losses (box 77) are relieved against other
  // income (box 78, defaulting to the whole loss).
  if (income.selfEmployment.some(s => tradeAddBacks(s) !== 0 || tradeCapitalAllowances(s) !== 0)) notes.push('Trade profit is tax-adjusted (add-backs less capital allowances).');
  let tradeProfit = sum(income.selfEmployment.map(tradeTaxableProfit));
  const tradeLossSideways = sum(income.selfEmployment.map(t => {
    const loss = tradeAdjustedLoss(t);
    return Math.min(loss, t.lossSetOffOtherIncome ?? loss);
  }));
  if (income.selfEmployment.some(t => (t.lossBroughtForward || 0) > 0)) notes.push('Brought-forward trade losses set against each trade’s profit.');
  // Back-compat: honour the income-level brought-forward loss when no trade sets box 74.
  if (income.selfEmployment.every(t => !(t.lossBroughtForward)) && (income.tradeLossBroughtForward || 0) > 0) {
    tradeProfit = Math.max(0, tradeProfit - (income.tradeLossBroughtForward || 0));
    notes.push('Brought-forward trade losses set against trade profit.');
  }

  const partnerships = income.partnerships ?? [];
  const partnershipProfit = sum(partnerships.map(partnershipTaxableProfit));
  const partnershipClass4 = sum(partnerships.filter(p => !p.class4Exempt).map(p => partnershipTaxableProfit(p) + (p.class4Adjustment || 0)));
  const partnershipSavings = sum(partnerships.map(partnershipTotalUntaxedSavings));
  const partnershipDividends = sum(partnerships.map(p => p.dividends || 0));
  const partnershipTaxTaken = sum(partnerships.map(partnershipTaxTakenTotal));
  const partnershipProperty = sum(partnerships.map(partnershipPropertyTaxable));
  const propertyProfit = sum(income.property.map(propertyTaxableShare)) + partnershipProperty;
  const pensionsBenefits = pensionsBenefitsTotal(income); // boxes 8, 9, 11, 13, 15, 16
  const ft = foreignTotals(income);
  const tr = trustTotals(income);
  const foreignIncome = ft.other;              // foreign non-savings/non-dividend → NSND
  const foreignTaxPaid = ft.taxClaimed;
  const otherIncome = otherIncomeNet(income);  // box 17 − 18 + 20
  const chargeableEventGains = income.additional?.chargeableEventGains || 0; // SA101 life-insurance gains (box 4, with credit)
  const sa101 = sa101ExtraIncome(income);   // other SA101 income + credits
  const minister = ministerComputed(income.minister); // SA102M taxable income + tax
  const niAssembly = assemblyComputed(income.niAssembly); // SA102 NI Assembly office income + tax
  const parliament = parliamentComputed(income.parliament); // SA102 MPs office income + tax
  const savingsIncome = savingsInterestTotal(income) + taxedInterestGross(income) + (income.untaxedForeignInterest || 0) + ft.interest + partnershipSavings + tr.savings;
  const dividendIncome = dividendsTotal(income) + lineTotal(income.otherDividendsItems, income.otherDividends || 0) + lineTotal(income.foreignDividendsItems, income.foreignDividendsMain || 0) + ft.dividends + partnershipDividends + tr.dividend + sa101.dividends;
  // Residential finance costs: per-property (SA105 box 44) when itemised, else
  // the legacy income-level figure (e.g. from an older Landlord import).
  const perPropertyFinance = sum(income.property.map(propertyFinanceShare));
  const financeCosts = perPropertyFinance > 0 ? perPropertyFinance : (income.financeCosts || 0);
  const region = income.region ?? 'uk';

  let nsnd = employmentIncome + tradeProfit + partnershipProfit + propertyProfit + pensionsBenefits + otherIncome + foreignIncome + chargeableEventGains + sa101.nonSavings + minister.taxable + niAssembly.taxable + parliament.taxable + tr.nonSavings;
  if (tradeLossSideways > 0) {
    const relief = Math.min(tradeLossSideways, nsnd);
    nsnd -= relief;
    notes.push('Current-year trade loss set sideways against other income (s.64).');
  }
  const totalIncome = nsnd + savingsIncome + dividendIncome;

  // Band extension + adjusted net income (for PA taper) via grossed reliefs.
  const grossGiftAid = giftAidNet(income) * 1.25;
  const grossPension = pensionBandExtension(income);
  // Gifts of shares/land to charity (boxes 9–10) are a deduction from total
  // income — relieved at the taxpayer's marginal rate, applied below alongside
  // the personal allowance (non-savings → savings → dividends). They also reduce
  // adjusted net income for the PA taper, but do NOT extend the rate bands.
  const assetGifts = charityAssetGifts(income);
  if (assetGifts > 0) notes.push('Gifts of qualifying shares / land to charity deducted from income (relief at the marginal rate).');
  const brl = BASIC_RATE_LIMIT + grossGiftAid + grossPension;
  const addl = ADDITIONAL_THRESHOLD + grossGiftAid + grossPension;

  const adjustedNetIncome = totalIncome - grossGiftAid - grossPension - assetGifts;
  let personalAllowance = PA;
  let paTapered = false;
  if (adjustedNetIncome > PA_TAPER_THRESHOLD) {
    personalAllowance = Math.max(0, PA - Math.floor((adjustedNetIncome - PA_TAPER_THRESHOLD) / 2));
    paTapered = true;
    notes.push('Personal allowance restricted by the £100,000 income taper.');
  }
  if (income.marriageAllowance === 'transferred') {
    personalAllowance = Math.max(0, personalAllowance - MARRIAGE_ALLOWANCE_TRANSFER);
    notes.push('Personal allowance reduced by a Marriage Allowance transfer to a spouse/civil partner.');
  }
  if (income.registeredBlind) {
    personalAllowance += BLIND_PERSONS_ALLOWANCE;
    notes.push('Blind Person’s Allowance added to the personal allowance.');
  }
  if (income.blindSpouseSurplusClaim) {
    personalAllowance += BLIND_PERSONS_ALLOWANCE;
    notes.push('Spouse’s surplus Blind Person’s Allowance claimed.');
  }
  // Claiming FIG relief (boxes 28/29) or the legacy remittance basis withdraws the
  // personal allowance and the CGT annual exempt amount.
  const res = income.residence;
  const figClaim = !!(res?.figIncomeClaim || res?.figGainsClaim);
  const remittanceBasis = !!res?.remittanceBasis || figClaim;
  if (remittanceBasis) {
    personalAllowance = 0;
    notes.push(figClaim
      ? 'Foreign income & gains (FIG) regime claimed (SA109 box 28/29) — personal allowance and CGT annual exempt amount withdrawn.'
      : 'Remittance basis claimed — personal allowance and CGT annual exempt amount withdrawn (replaced by the FIG regime from 6 April 2025; transitional rules may apply).');
  }
  // Non-resident (box 1) or split-year status. A non-resident is not automatically
  // entitled to UK personal allowances unless claimed under a DTA (box 15) or on
  // another basis (box 16); flag rather than silently deny/grant.
  const nonResident = !!(res?.notResident || res?.splitYear || (res?.status && res.status !== 'resident'));
  if (nonResident) {
    const paClaim = !!(res?.paUnderDta || res?.paOtherBasis);
    notes.push(paClaim
      ? 'Non-resident / split-year — UK personal allowances claimed under a DTA / other basis (SA109 box 15/16). Income apportionment and residence reliefs are not modelled here; review before filing.'
      : 'Non-resident / split-year status noted — a non-resident may not be entitled to UK personal allowances (SA109 box 15/16 not ticked), and income apportionment / residence reliefs are not modelled here; review before filing.');
  }

  // Allocate the personal allowance + any charity asset-gift deduction:
  // non-savings → savings → dividends.
  const incomeDeduction = personalAllowance + assetGifts;
  const dedNsnd = Math.min(nsnd, incomeDeduction);
  const dedSavings = Math.min(savingsIncome, incomeDeduction - dedNsnd);
  const dedDiv = Math.min(dividendIncome, incomeDeduction - dedNsnd - dedSavings);
  const taxableNonSavings = Math.max(0, nsnd - dedNsnd);
  const taxableSavings = Math.max(0, savingsIncome - dedSavings);
  const taxableDividends = Math.max(0, dividendIncome - dedDiv);
  const taxableIncome = taxableNonSavings + taxableSavings + taxableDividends;

  // Top marginal band → PSA size.
  const marginalBand: Band = taxableIncome > addl ? 'additional' : taxableIncome > brl ? 'higher' : 'basic';
  const psa = marginalBand === 'additional' ? 0 : marginalBand === 'higher' ? PSA_HIGHER : PSA_BASIC;

  const lines: TaxLine[] = [];
  let used = 0;

  // Non-savings, non-dividend. Scottish taxpayers use the Scottish bands here;
  // savings & dividends below still use UK rates/thresholds.
  if (region === 'scotland') {
    let rem = taxableNonSavings;
    SCOT_BANDS.forEach((b, i) => {
      if (rem <= 0) return;
      const width = i === 1 ? b.width + grossGiftAid + grossPension : b.width; // reliefs widen the basic band
      const amt = Math.min(rem, width);
      if (amt > 0) lines.push({ label: `Income (${b.key})`, band: b.rate >= 0.42 ? (b.rate >= 0.48 ? 'additional' : 'higher') : 'basic', amount: amt, rate: b.rate, tax: amt * b.rate });
      rem -= amt;
    });
    used += taxableNonSavings;
  } else {
    const p = placeInBands(taxableNonSavings, used, brl, addl);
    if (p.basic > 0) lines.push({ label: 'Income (basic)', band: 'basic', amount: p.basic, rate: R_BASIC, tax: p.basic * R_BASIC });
    if (p.higher > 0) lines.push({ label: 'Income (higher)', band: 'higher', amount: p.higher, rate: R_HIGHER, tax: p.higher * R_HIGHER });
    if (p.additional > 0) lines.push({ label: 'Income (additional)', band: 'additional', amount: p.additional, rate: R_ADDITIONAL, tax: p.additional * R_ADDITIONAL });
    used += taxableNonSavings;
  }

  // Savings: 0% (starting-rate band + PSA) then standard bands.
  {
    const startingBand = Math.max(0, SAVINGS_STARTING_BAND - taxableNonSavings);
    const zero = Math.min(taxableSavings, startingBand + psa);
    if (zero > 0) { lines.push({ label: 'Savings (0%)', band: 'starting', amount: zero, rate: 0, tax: 0 }); used += zero; }
    const std = taxableSavings - zero;
    if (std > 0) {
      const p = placeInBands(std, used, brl, addl);
      if (p.basic > 0) lines.push({ label: 'Savings (basic)', band: 'basic', amount: p.basic, rate: R_BASIC, tax: p.basic * R_BASIC });
      if (p.higher > 0) lines.push({ label: 'Savings (higher)', band: 'higher', amount: p.higher, rate: R_HIGHER, tax: p.higher * R_HIGHER });
      if (p.additional > 0) lines.push({ label: 'Savings (additional)', band: 'additional', amount: p.additional, rate: R_ADDITIONAL, tax: p.additional * R_ADDITIONAL });
      used += std;
    }
  }

  // Dividends: allowance at 0% then dividend rates.
  {
    const allow = Math.min(taxableDividends, DIV_ALLOWANCE);
    if (allow > 0) { lines.push({ label: 'Dividend allowance', band: 'allowance', amount: allow, rate: 0, tax: 0 }); used += allow; }
    const std = taxableDividends - allow;
    if (std > 0) {
      const p = placeInBands(std, used, brl, addl);
      if (p.basic > 0) lines.push({ label: 'Dividends (basic)', band: 'basic', amount: p.basic, rate: DIV_BASIC, tax: p.basic * DIV_BASIC });
      if (p.higher > 0) lines.push({ label: 'Dividends (higher)', band: 'higher', amount: p.higher, rate: DIV_HIGHER, tax: p.higher * DIV_HIGHER });
      if (p.additional > 0) lines.push({ label: 'Dividends (additional)', band: 'additional', amount: p.additional, rate: DIV_ADDITIONAL, tax: p.additional * DIV_ADDITIONAL });
      used += std;
    }
  }

  const incomeTaxBeforeReducers = sum(lines.map(l => l.tax));

  // Residential finance-cost reducer (individuals): 20% of the lower of finance
  // costs, property profit, and total taxable income.
  let financeCostReducer = 0;
  if (financeCosts > 0) {
    const base = Math.min(financeCosts, propertyProfit, taxableIncome);
    financeCostReducer = Math.max(0, base) * FINANCE_RELIEF;
    if (base > 0) notes.push('Residential finance costs relieved as a 20% tax reducer.');
  }
  const marriageAllowanceReducer = income.marriageAllowance === 'received' ? MARRIAGE_ALLOWANCE_REDUCER : 0;
  if (marriageAllowanceReducer > 0) notes.push('Marriage Allowance received — £252 tax reducer applied.');
  // Foreign Tax Credit Relief — simplified: the lower of the foreign tax paid
  // and UK tax on that income at the marginal rate.
  const marginalRate = marginalBand === 'additional' ? R_ADDITIONAL : marginalBand === 'higher' ? R_HIGHER : R_BASIC;
  let foreignTaxCreditRelief = 0;
  if (ft.incomeClaimed > 0 && foreignTaxPaid > 0) {
    foreignTaxCreditRelief = Math.min(foreignTaxPaid, r0(ft.incomeClaimed * marginalRate));
    notes.push('Foreign Tax Credit Relief applied (simplified — lower of the foreign tax paid and UK tax on the foreign income).');
  }
  // SA101 venture-capital & other reliefs (EIS/SEIS/VCT/CITR/maintenance).
  const additionalReducers = r0(additionalReliefs(income));
  if (additionalReducers > 0) notes.push('Venture-capital / other reliefs (EIS, SEIS, VCT, etc.) applied as income-tax reducers.');
  const incomeTax = Math.max(0, incomeTaxBeforeReducers - financeCostReducer - marriageAllowanceReducer - foreignTaxCreditRelief - additionalReducers);

  // Class 4 NIC on trade + partnership profit share. Non-exempt trades only
  // (SA103F box 101), plus each trade's Class 4 adjustment (box 102).
  const tradeClass4Base = sum(income.selfEmployment.filter(t => !t.class4Exempt).map(t => tradeTaxableProfit(t) + (t.class4Adjustment || 0)));
  const class4Base = Math.max(0, tradeClass4Base) + partnershipClass4;
  const class4Nic = r0(Math.max(0, Math.min(class4Base, NIC_UPL) - NIC_LPL) * C4_MAIN + Math.max(0, class4Base - NIC_UPL) * C4_UPPER);
  if (income.selfEmployment.some(t => t.class2Voluntary)) notes.push('Voluntary Class 2 NIC selected on a trade — not included in the estimate; add it to the payment before filing.');

  // Student loan — 9% over the plan threshold, less any deducted by an employer,
  // plus a Postgraduate Loan (6% over £21,000) less its employer deductions.
  let studentLoan = 0;
  if (income.studentLoanPlan) {
    const threshold = SL_THRESHOLDS[income.studentLoanPlan];
    studentLoan = Math.floor(Math.max(0, totalIncome - threshold) * SL_RATE);
  }
  studentLoan = Math.max(0, studentLoan - (income.studentLoanDeducted || 0));
  if (income.postgradLoan) {
    const pgl = Math.floor(Math.max(0, totalIncome - PGL_THRESHOLD) * PGL_RATE);
    studentLoan += Math.max(0, pgl - (income.postgradLoanDeducted || 0));
  }

  // High Income Child Benefit Charge — 1% of child benefit for every £200 of
  // adjusted net income over £60,000, full clawback by £80,000.
  let hicbc = 0;
  const childBenefit = income.childBenefit || 0;
  if (childBenefit > 0 && adjustedNetIncome > HICBC_THRESHOLD) {
    const pct = Math.min(1, Math.floor((adjustedNetIncome - HICBC_THRESHOLD) / HICBC_STEP) * 0.01);
    hicbc = r0(childBenefit * pct);
    if (hicbc > 0) notes.push('High Income Child Benefit Charge applies.');
  }
  // Winter Fuel Payment / PAWHP high-income charge (2025/26) — fully recovered
  // where adjusted net income exceeds £35,000. Reported with the HICBC line.
  const winterFuel = income.winterFuelPayment || 0;
  if (winterFuel > 0 && adjustedNetIncome > WFP_CHARGE_THRESHOLD) {
    hicbc += r0(winterFuel);
    notes.push('Winter Fuel Payment / PAWHP recovered via the high-income charge (adjusted net income over £35,000).');
  }

  // Capital gains tax — gains stack above income; the unused basic-rate band
  // (extended by reliefs) is taxed at the lower rate, the rest at the higher.
  const cg = income.capitalGains;
  const s8 = income.sa108;
  let taxableGains = 0, capitalGainsTax = 0;
  if (cg || sa108HasData(s8)) {
    // Split gains into standard-rate (18/24) and BADR/Investors' Relief (14),
    // and gather in-year losses. Per-disposal working list takes precedence, then
    // the box-for-box SA108 page, then the quick-summary fallback.
    let normalGains = 0, badrGains = 0, inYearLosses = 0, broughtForward = cg?.lossesBroughtForward || 0;
    const disposals = cg?.disposals ?? [];
    if (disposals.length) {
      for (const d of disposals) {
        const { gain, loss } = disposalGainLoss(d);
        inYearLosses += loss;
        if (gain > 0) { if (d.relief === 'badr' || d.relief === 'investors') badrGains += gain; else normalGains += gain; }
      }
    } else if (sa108HasData(s8)) {
      const g = sa108Gains(s8!);
      normalGains = g.normalGains; badrGains = g.badrGains; inYearLosses = g.inYearLosses; broughtForward = g.broughtForwardUsed;
    } else if (cg) {
      normalGains = Math.max(0, (cg.residentialGains || 0) + (cg.otherGains || 0));
      inYearLosses = cg.losses || 0;
    }
    // Set losses (in-year + brought-forward) and the annual exempt amount against
    // the higher-taxed standard-rate gains first, then BADR gains. The AEA is
    // withdrawn when the remittance basis is claimed.
    const aea = remittanceBasis ? 0 : CGT_ANNUAL_EXEMPT;
    let deduction = inYearLosses + broughtForward + aea;
    const normAfter = Math.max(0, normalGains - deduction);
    deduction = Math.max(0, deduction - normalGains);
    const badrAfter = Math.max(0, badrGains - deduction);
    taxableGains = normAfter + badrAfter;
    if (taxableGains > 0) {
      const bandRemaining = Math.max(0, brl - taxableIncome);
      const lower = Math.min(normAfter, bandRemaining);
      capitalGainsTax = r0(lower * CGT_LOWER + (normAfter - lower) * CGT_HIGHER + badrAfter * CGT_BADR);
      notes.push(badrAfter > 0
        ? 'Capital gains: 18%/24% on standard gains, 14% on BADR/Investors’ Relief gains, after the £3,000 exemption.'
        : 'Capital gains taxed at 18%/24% after the £3,000 annual exempt amount.');
    }
  }

  const totalDue = r0(incomeTax) + class4Nic + studentLoan + hicbc + capitalGainsTax;
  // Tax already paid at source: PAYE on employment + CIS on trades + tax taken
  // off property income + basic-rate credit on UK life-insurance gains.
  const cisDeducted = sum(income.selfEmployment.map(t => (t.cisDeductions || 0) + (t.otherTaxTaken || 0)));
  const propertyTaxTaken = sum(income.property.map(p => (p.taxTaken || 0) * ownerShareFraction(p.owners)));
  const chargeableEventCredit = income.additional?.chargeableEventUkPolicy ? r0(chargeableEventGains * R_BASIC) : 0;
  if (cisDeducted > 0) notes.push('CIS deductions credited against the liability.');
  if (chargeableEventCredit > 0) notes.push('Basic-rate tax treated as paid on the UK life-insurance gain; top-slicing relief not modelled.');
  const trustCredit = r0(tr.taxCredit);
  if (trustCredit > 0) notes.push('Tax credit on trust / estate income set against the liability.');
  const taxDeductedAtSource = r0(taxDeducted + cisDeducted + propertyTaxTaken + partnershipTaxTaken + chargeableEventCredit + sa101.taxDeducted + minister.taxDeducted + niAssembly.taxDeducted + parliament.taxDeducted + trustCredit + taxedInterestTaxCredit(income) + lineTotal(income.foreignDividendsTaxItems, income.foreignDividendsTax || 0) + pensionsBenefitsTaxCredit(income) + otherIncomeTaxCredit(income));
  // Tax already refunded / set off in-year (TR6 box 1) is added back to what's due.
  const taxRefundedOrSetOff = income.taxRefundedOrSetOff || 0;
  if (taxRefundedOrSetOff > 0) notes.push('Tax refunded or set off in-year (box 1) added back to the balancing payment.');
  const balancingPayment = Math.max(0, totalDue - taxDeductedAtSource + taxRefundedOrSetOff);

  // Payments on account — on the income tax + Class 4 "relevant amount" (not
  // student loan / CGT); due unless < £1,000 or ≥80% collected at source.
  const relevantAmount = r0(incomeTax) + class4Nic - taxDeductedAtSource;
  const poaApplies = relevantAmount >= 1000 && taxDeductedAtSource < 0.8 * (r0(incomeTax) + class4Nic);
  const paymentOnAccount = poaApplies ? r0(relevantAmount / 2) : 0;

  if (region === 'scotland') notes.push('Scottish rates applied to earned income; savings & dividends use UK rates.');
  notes.push('Excludes BADR/Investors’ Relief, top-slicing relief and averaging — review before filing.');

  return {
    taxYear,
    employmentIncome: r0(employmentIncome), tradeProfit: r0(tradeProfit), partnershipProfit: r0(partnershipProfit), propertyProfit: r0(propertyProfit),
    savingsIncome: r0(savingsIncome), dividendIncome: r0(dividendIncome), otherIncome: r0(otherIncome + pensionsBenefits + foreignIncome + chargeableEventGains + sa101.nonSavings + minister.taxable + niAssembly.taxable + parliament.taxable + tr.nonSavings),
    otherIncomeParts: ([
      { label: 'Pensions & state benefits', amount: r0(pensionsBenefits) },
      { label: 'Minister of religion (SA102M)', amount: r0(minister.taxable) },
      { label: 'NI Legislative Assembly (SA102)', amount: r0(niAssembly.taxable) },
      { label: 'Parliament — MPs (SA102)', amount: r0(parliament.taxable) },
      { label: 'Life insurance gains', amount: r0(chargeableEventGains) },
      { label: 'Other UK income (SA101)', amount: r0(sa101.nonSavings) },
      { label: 'Foreign income', amount: r0(foreignIncome) },
      { label: 'Trusts & estates', amount: r0(tr.nonSavings) },
      { label: 'Any other income', amount: r0(otherIncome) },
    ] as { label: string; amount: number }[]).filter(p => p.amount > 0),
    totalIncome: r0(totalIncome),
    personalAllowance: r0(personalAllowance), paTapered, charityAssetGiftsDeduction: r0(assetGifts),
    taxableNonSavings: r0(taxableNonSavings), taxableSavings: r0(taxableSavings), taxableDividends: r0(taxableDividends),
    taxableIncome: r0(taxableIncome),
    lines,
    incomeTaxBeforeReducers: r0(incomeTaxBeforeReducers),
    financeCostReducer: r0(financeCostReducer),
    marriageAllowanceReducer,
    foreignTaxCreditRelief,
    additionalReliefs: additionalReducers,
    incomeTax: r0(incomeTax),
    class4Nic, studentLoan, hicbc,
    taxableGains: r0(taxableGains), capitalGainsTax,
    totalDue,
    taxDeductedAtSource,
    balancingPayment,
    paymentOnAccount, poaApplies,
    effectiveRate: totalIncome > 0 ? totalDue / totalIncome : 0,
    marginalBand,
    notes,
  };
}

// ── Legacy adapters ──────────────────────────────────────────────────────────
export function estimateSa100(income: Sa100Income, taxYear = '2025/26'): TaxEstimate {
  const c = computeSa100Full(income, taxYear);
  const dividendTax = r0(sum(c.lines.filter(l => l.label.startsWith('Dividend')).map(l => l.tax)));
  const incomeTaxNonDiv = Math.max(0, c.incomeTax - dividendTax);
  return {
    taxYear: c.taxYear,
    totalIncome: c.totalIncome,
    nonDividendIncome: c.totalIncome - c.dividendIncome,
    dividendIncome: c.dividendIncome,
    personalAllowance: c.personalAllowance,
    taxableIncome: c.taxableIncome,
    bands: c.lines.map(l => ({ label: l.label, amount: l.amount, rate: l.rate, tax: l.tax })),
    incomeTax: incomeTaxNonDiv,
    dividendTax,
    taxDeductedAtSource: c.taxDeductedAtSource,
    totalTax: c.totalDue,
    balancingPayment: c.balancingPayment,
    paymentOnAccount: c.paymentOnAccount,
    effectiveRate: c.effectiveRate,
  };
}

/** SA National Insurance (Class 4). For a whole-position planning view that also
 *  reflects employee Class 1, pass includeClass1. */
export function estimateNic(income: Sa100Income, includeClass1 = true): number {
  const c = computeSa100Full(income);
  let nic = c.class4Nic;
  if (includeClass1) {
    for (const e of income.employment) {
      const pay = Math.max(0, e.pay);
      nic += Math.max(0, Math.min(pay, NIC_UPL) - NIC_LPL) * C1_MAIN + Math.max(0, pay - NIC_UPL) * C1_UPPER;
    }
  }
  return r0(nic);
}
