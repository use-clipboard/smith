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

import type { Sa100Income, EmploymentSource } from './types';

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
  // Tax-adjusted trade profit: accounts profit + add-backs (disallowables /
  // depreciation) − capital allowances, floored at nil per trade.
  const adjustedTrade = (s: { profit: number; addBacks?: number; capitalAllowances?: number }) =>
    s.profit + (s.addBacks || 0) - (s.capitalAllowances || 0);
  if (income.selfEmployment.some(s => (s.addBacks || 0) !== 0 || (s.capitalAllowances || 0) !== 0)) notes.push('Trade profit is tax-adjusted (add-backs less capital allowances).');
  // Net all trades, then apply brought-forward trade losses; a remaining net
  // loss is relieved sideways against other income (in-year s.64).
  const netTrade = sum(income.selfEmployment.map(adjustedTrade)) - (income.tradeLossBroughtForward || 0);
  if ((income.tradeLossBroughtForward || 0) > 0) notes.push('Brought-forward trade losses set against trade profit.');
  const tradeProfit = Math.max(0, netTrade);
  const tradeLossSideways = netTrade < 0 ? -netTrade : 0;

  const partnershipProfit = sum((income.partnerships ?? []).map(p => Math.max(0, p.profit)));
  const propertyProfit = sum(income.property.map(p => Math.max(0, p.profit)));
  const pensionsIncome = income.pensionsIncome || 0;
  const statePension = income.statePension || 0;
  const foreignIncome = income.foreign?.income || 0;
  const foreignTaxPaid = income.foreign?.foreignTaxPaid || 0;
  const otherIncome = income.otherIncome || 0;
  const savingsIncome = income.savingsInterest || 0;
  const dividendIncome = income.dividends || 0;
  const financeCosts = income.financeCosts || 0;
  const region = income.region ?? 'uk';

  let nsnd = employmentIncome + tradeProfit + partnershipProfit + propertyProfit + pensionsIncome + statePension + otherIncome + foreignIncome;
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
  if (foreignIncome > 0 && foreignTaxPaid > 0) {
    foreignTaxCreditRelief = Math.min(foreignTaxPaid, r0(foreignIncome * marginalRate));
    notes.push('Foreign Tax Credit Relief applied (simplified — lower of the foreign tax paid and UK tax on the foreign income).');
  }
  const incomeTax = Math.max(0, incomeTaxBeforeReducers - financeCostReducer - marriageAllowanceReducer - foreignTaxCreditRelief);

  // Class 4 NIC on trade + partnership profit share. (Class 2 not charged 2025/26.)
  const class4Base = tradeProfit + partnershipProfit;
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
    const gains = Math.max(0, (cg.residentialGains || 0) + (cg.otherGains || 0) - (cg.losses || 0));
    taxableGains = Math.max(0, gains - CGT_ANNUAL_EXEMPT);
    if (taxableGains > 0) {
      const bandRemaining = Math.max(0, brl - taxableIncome);
      const lower = Math.min(taxableGains, bandRemaining);
      capitalGainsTax = r0(lower * CGT_LOWER + (taxableGains - lower) * CGT_HIGHER);
      notes.push('Capital gains taxed at 18%/24% after the £3,000 annual exempt amount.');
    }
  }

  const totalDue = r0(incomeTax) + class4Nic + studentLoan + hicbc + capitalGainsTax;
  const taxDeductedAtSource = r0(taxDeducted);
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
    savingsIncome: r0(savingsIncome), dividendIncome: r0(dividendIncome), otherIncome: r0(otherIncome + pensionsIncome + statePension + foreignIncome),
    totalIncome: r0(totalIncome),
    personalAllowance: r0(personalAllowance), paTapered,
    taxableNonSavings: r0(taxableNonSavings), taxableSavings: r0(taxableSavings), taxableDividends: r0(taxableDividends),
    taxableIncome: r0(taxableIncome),
    lines,
    incomeTaxBeforeReducers: r0(incomeTaxBeforeReducers),
    financeCostReducer: r0(financeCostReducer),
    marriageAllowanceReducer,
    foreignTaxCreditRelief,
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
