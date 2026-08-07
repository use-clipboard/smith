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

import type { Sa100Income, EmploymentSource, TradeSource, PropertySource, PartnershipSource, CgtDisposal } from './types';

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
  return { nonSavings, savings, dividend, taxCredit };
}

// ── SA104 partnership helper ─────────────────────────────────────────────────
/** This partner's taxable share of the partnership trade profit: share +
 *  basis-period adjustments − brought-forward loss, floored at nil. */
export function partnershipTaxableProfit(p: PartnershipSource): number {
  return Math.max(0, (p.profit || 0) + (p.adjustments || 0) - (p.lossBroughtForward || 0));
}

/** Dividends total — sum of the itemised breakdown when present, else the scalar. */
export function dividendsTotal(income: Sa100Income): number {
  const items = income.dividendItems;
  if (items && items.length) return items.reduce((a, d) => a + (d.amount || 0), 0);
  return income.dividends || 0;
}

/** Untaxed UK interest (box 2) — itemised sum when present, else the scalar. */
export function savingsInterestTotal(income: Sa100Income): number {
  const items = income.savingsInterestItems;
  if (items && items.length) return items.reduce((a, s) => a + (s.amount || 0), 0);
  return income.savingsInterest || 0;
}
/** Taxed UK interest (box 1) grossed up: net + tax across the breakdown. */
export function taxedInterestGross(income: Sa100Income): number {
  return (income.taxedInterestItems ?? []).reduce((a, t) => a + (t.net || 0) + (t.tax || 0), 0);
}
/** Tax deducted at source on taxed UK interest (box 1). */
export function taxedInterestTaxCredit(income: Sa100Income): number {
  return (income.taxedInterestItems ?? []).reduce((a, t) => a + (t.tax || 0), 0);
}

// ── Generic itemised line helpers (pensions & other income) ──────────────────
const sumLines = (items?: { amount: number }[]) => (items ?? []).reduce((a, x) => a + (x.amount || 0), 0);
/** Itemised sum when present, else the scalar fallback. */
function lineTotal(items: { amount: number }[] | undefined, scalar = 0): number {
  return items && items.length ? sumLines(items) : scalar;
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
  const sources = income.foreign?.sources ?? [];
  if (!sources.length) {
    const inc = income.foreign?.income || 0, tax = income.foreign?.foreignTaxPaid || 0;
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

/** Total of the itemised expense boxes (17–30). */
export function tradeExpensesTotal(t: TradeSource): number {
  return TRADE_EXP_KEYS.reduce((a, k) => a + (t[k] || 0), 0);
}
/** True once any income/expense box is used — then net profit is derived. */
export function tradeItemised(t: TradeSource): boolean {
  return (t.turnover || 0) > 0 || (t.otherBusinessIncome || 0) > 0 || tradeExpensesTotal(t) > 0;
}
/** Accounts net profit: derived from turnover − expenses when itemised, else the
 *  imported/entered accounts profit. */
export function tradeNetProfit(t: TradeSource): number {
  return tradeItemised(t) ? (t.turnover || 0) + (t.otherBusinessIncome || 0) - tradeExpensesTotal(t) : (t.profit || 0);
}
export function tradeCapitalAllowances(t: TradeSource): number {
  return (t.aia || 0) + (t.capitalAllowances || 0);
}
export function tradeAddBacks(t: TradeSource): number {
  return (t.addBacks || 0) + (t.goodsOwnUse || 0) + (t.balancingCharges || 0);
}
/** Tax-adjusted trade profit (signed — a loss stays negative so it can net
 *  against other trades / be relieved sideways). */
export function tradeAdjustedProfit(t: TradeSource): number {
  return tradeNetProfit(t) + tradeAddBacks(t) - tradeCapitalAllowances(t);
}

// ── SA105 property helpers ───────────────────────────────────────────────────
const PROP_EXP_KEYS = ['expPremises', 'expRepairs', 'expLoanInterest', 'expProfessional', 'expServices', 'expOther'] as const;

export function propertyExpensesTotal(p: PropertySource): number {
  return PROP_EXP_KEYS.reduce((a, k) => a + (p[k] || 0), 0);
}
export function propertyItemised(p: PropertySource): boolean {
  return (p.rents || 0) > 0 || (p.premiums || 0) > 0 || propertyExpensesTotal(p) > 0;
}
/** Net rental profit before tax adjustments — derived from rents − expenses when
 *  itemised, else the imported/entered accounts profit. */
export function propertyNetProfit(p: PropertySource): number {
  return propertyItemised(p) ? (p.rents || 0) + (p.premiums || 0) - propertyExpensesTotal(p) : (p.profit || 0);
}
/** Taxable property profit for one property: net profit + adjustments − reliefs
 *  − brought-forward loss, floored at nil (property losses carry forward, they
 *  are not relieved sideways). */
export function propertyTaxable(p: PropertySource): number {
  const adjusted = propertyNetProfit(p) + (p.privateUse || 0) + (p.balancingCharges || 0)
    - (p.aia || 0) - (p.capitalAllowances || 0) - (p.domesticItems || 0) - (p.rentARoom || 0);
  return Math.max(0, adjusted - (p.lossBroughtForward || 0));
}

// ── SA108 capital-gains helpers ──────────────────────────────────────────────
/** Chargeable gain (after reliefs) and allowable loss for one disposal. */
export function disposalGainLoss(d: CgtDisposal): { gain: number; loss: number } {
  const raw = (d.proceeds || 0) - (d.cost || 0);
  if (raw > 0) return { gain: Math.max(0, raw - (d.reliefs || 0)), loss: 0 };
  return { gain: 0, loss: -raw };
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
  totalIncome: number;

  personalAllowance: number;
  paTapered: boolean;
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
  // Tax-adjusted trade profit: net profit (derived from turnover − expenses when
  // itemised) + add-backs (disallowables, goods for own use, balancing charges)
  // − capital allowances (AIA + WDA). See tradeAdjustedProfit.
  if (income.selfEmployment.some(s => tradeAddBacks(s) !== 0 || tradeCapitalAllowances(s) !== 0)) notes.push('Trade profit is tax-adjusted (add-backs less capital allowances).');
  // Net all trades, then apply brought-forward trade losses; a remaining net
  // loss is relieved sideways against other income (in-year s.64).
  const netTrade = sum(income.selfEmployment.map(tradeAdjustedProfit)) - (income.tradeLossBroughtForward || 0);
  if ((income.tradeLossBroughtForward || 0) > 0) notes.push('Brought-forward trade losses set against trade profit.');
  const tradeProfit = Math.max(0, netTrade);
  const tradeLossSideways = netTrade < 0 ? -netTrade : 0;

  const partnerships = income.partnerships ?? [];
  const partnershipProfit = sum(partnerships.map(partnershipTaxableProfit));
  const partnershipClass4 = sum(partnerships.filter(p => !p.class4Exempt).map(partnershipTaxableProfit));
  const partnershipSavings = sum(partnerships.map(p => p.savingsInterest || 0));
  const partnershipDividends = sum(partnerships.map(p => p.dividends || 0));
  const partnershipTaxTaken = sum(partnerships.map(p => p.taxTaken || 0));
  const propertyProfit = sum(income.property.map(propertyTaxable));
  const pensionsBenefits = pensionsBenefitsTotal(income); // boxes 8, 9, 11, 13, 15, 16
  const ft = foreignTotals(income);
  const tr = trustTotals(income);
  const foreignIncome = ft.other;              // foreign non-savings/non-dividend → NSND
  const foreignTaxPaid = ft.taxClaimed;
  const otherIncome = otherIncomeNet(income);  // box 17 − 18 + 20
  const chargeableEventGains = income.additional?.chargeableEventGains || 0; // SA101 life-insurance gains
  const savingsIncome = savingsInterestTotal(income) + taxedInterestGross(income) + (income.untaxedForeignInterest || 0) + ft.interest + partnershipSavings + tr.savings;
  const dividendIncome = dividendsTotal(income) + (income.otherDividends || 0) + (income.foreignDividendsMain || 0) + ft.dividends + partnershipDividends + tr.dividend;
  // Residential finance costs: per-property (SA105 box 44) when itemised, else
  // the legacy income-level figure (e.g. from an older Landlord import).
  const perPropertyFinance = sum(income.property.map(p => p.residentialFinanceCosts || 0));
  const financeCosts = perPropertyFinance > 0 ? perPropertyFinance : (income.financeCosts || 0);
  const region = income.region ?? 'uk';

  let nsnd = employmentIncome + tradeProfit + partnershipProfit + propertyProfit + pensionsBenefits + otherIncome + foreignIncome + chargeableEventGains + tr.nonSavings;
  if (tradeLossSideways > 0) {
    const relief = Math.min(tradeLossSideways, nsnd);
    nsnd -= relief;
    notes.push('Current-year trade loss set sideways against other income (s.64).');
  }
  const totalIncome = nsnd + savingsIncome + dividendIncome;

  // Band extension + adjusted net income (for PA taper) via grossed reliefs.
  const grossGiftAid = (income.giftAid || 0) * 1.25;
  const grossPension = (income.pensionContributions || 0) * 1.25;
  const brl = BASIC_RATE_LIMIT + grossGiftAid + grossPension;
  const addl = ADDITIONAL_THRESHOLD + grossGiftAid + grossPension;

  const adjustedNetIncome = totalIncome - grossGiftAid - grossPension;
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
  const remittanceBasis = !!income.residence?.remittanceBasis;
  if (remittanceBasis) {
    personalAllowance = 0;
    notes.push('Remittance basis claimed — personal allowance and CGT annual exempt amount withdrawn (the remittance basis was replaced by the FIG regime from 6 April 2025; transitional rules may apply).');
  }
  if (income.residence && income.residence.status && income.residence.status !== 'resident') {
    notes.push('Non-resident / split-year status noted — income apportionment and residence reliefs are not modelled here; review before filing.');
  }

  // Allocate PA: non-savings → savings → dividends.
  const paNsnd = Math.min(nsnd, personalAllowance);
  const paSavings = Math.min(savingsIncome, personalAllowance - paNsnd);
  const paDiv = Math.min(dividendIncome, personalAllowance - paNsnd - paSavings);
  const taxableNonSavings = Math.max(0, nsnd - paNsnd);
  const taxableSavings = Math.max(0, savingsIncome - paSavings);
  const taxableDividends = Math.max(0, dividendIncome - paDiv);
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

  // Class 4 NIC on trade + partnership profit share. (Class 2 not charged 2025/26.)
  const class4Base = tradeProfit + partnershipClass4;
  const class4Nic = r0(Math.max(0, Math.min(class4Base, NIC_UPL) - NIC_LPL) * C4_MAIN + Math.max(0, class4Base - NIC_UPL) * C4_UPPER);

  // Student loan — 9% of income above the plan threshold.
  let studentLoan = 0;
  if (income.studentLoanPlan) {
    const threshold = SL_THRESHOLDS[income.studentLoanPlan];
    studentLoan = Math.floor(Math.max(0, totalIncome - threshold) * SL_RATE);
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

  // Capital gains tax — gains stack above income; the unused basic-rate band
  // (extended by reliefs) is taxed at the lower rate, the rest at the higher.
  const cg = income.capitalGains;
  let taxableGains = 0, capitalGainsTax = 0;
  if (cg) {
    // Split gains into standard-rate (18/24) and BADR/Investors' Relief (14),
    // and gather in-year losses. Itemised disposals take precedence.
    let normalGains = 0, badrGains = 0, inYearLosses = 0;
    const disposals = cg.disposals ?? [];
    if (disposals.length) {
      for (const d of disposals) {
        const { gain, loss } = disposalGainLoss(d);
        inYearLosses += loss;
        if (gain > 0) { if (d.relief === 'badr' || d.relief === 'investors') badrGains += gain; else normalGains += gain; }
      }
    } else {
      normalGains = Math.max(0, (cg.residentialGains || 0) + (cg.otherGains || 0));
      inYearLosses = cg.losses || 0;
    }
    // Set losses (in-year + brought-forward) and the annual exempt amount against
    // the higher-taxed standard-rate gains first, then BADR gains. The AEA is
    // withdrawn when the remittance basis is claimed.
    const aea = remittanceBasis ? 0 : CGT_ANNUAL_EXEMPT;
    let deduction = inYearLosses + (cg.lossesBroughtForward || 0) + aea;
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
  const cisDeducted = sum(income.selfEmployment.map(t => t.cisDeductions || 0));
  const propertyTaxTaken = sum(income.property.map(p => p.taxTaken || 0));
  const chargeableEventCredit = income.additional?.chargeableEventUkPolicy ? r0(chargeableEventGains * R_BASIC) : 0;
  if (cisDeducted > 0) notes.push('CIS deductions credited against the liability.');
  if (chargeableEventCredit > 0) notes.push('Basic-rate tax treated as paid on the UK life-insurance gain; top-slicing relief not modelled.');
  const trustCredit = r0(tr.taxCredit);
  if (trustCredit > 0) notes.push('Tax credit on trust / estate income set against the liability.');
  const taxDeductedAtSource = r0(taxDeducted + cisDeducted + propertyTaxTaken + partnershipTaxTaken + chargeableEventCredit + trustCredit + taxedInterestTaxCredit(income) + (income.foreignDividendsTax || 0) + pensionsBenefitsTaxCredit(income) + otherIncomeTaxCredit(income));
  const balancingPayment = Math.max(0, totalDue - taxDeductedAtSource);

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
    savingsIncome: r0(savingsIncome), dividendIncome: r0(dividendIncome), otherIncome: r0(otherIncome + pensionsBenefits + foreignIncome + chargeableEventGains + tr.nonSavings),
    totalIncome: r0(totalIncome),
    personalAllowance: r0(personalAllowance), paTapered,
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
