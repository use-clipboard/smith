// Tax Studio — New Return wizard: metadata + helpers.

import type { LucideIcon } from 'lucide-react';
import {
  Briefcase, Calculator, Home, Building2, ShieldCheck, Receipt,
} from 'lucide-react';
import type { ReturnTypeId, Sa100Income } from '../types';
import { emptyIncome } from '../data';
import { dividendsTotal, savingsInterestTotal, lineTotal, computeCapitalAllowances } from '../calc';
import type { TradeSource } from '../types';

/** Roll one trade forward: last year's closing capital-allowance pools become
 *  this year's brought-forward, and this year's WDA on them is computed up front
 *  (additions/disposals start empty). Other figures copy as a template. */
function rollTradeForward(s: TradeSource): TradeSource {
  const bfMain = s.capitalAllowancesCalc?.mainPoolCfwd ?? 0;
  const bfSpecial = s.capitalAllowancesCalc?.specialPoolCfwd ?? 0;
  const base = { ...s, aia: 0, ca18: 0, ca6: 0, enhancedCapitalAllowances: 0, allowancesOnSale: 0, balancingCharges: 0 };
  if (!bfMain && !bfSpecial) return { ...base, capitalAllowancesCalc: undefined };
  const caState = { mainPoolBfwd: bfMain, specialPoolBfwd: bfSpecial, additions: [], disposals: [] };
  const r = computeCapitalAllowances(caState);
  return {
    ...base,
    aia: r.aia, ca18: r.wdaMain, ca6: r.wdaSpecial,
    enhancedCapitalAllowances: r.fya, allowancesOnSale: r.balancingAllowance, balancingCharges: r.balancingCharge,
    capitalAllowancesCalc: { ...caState, mainPoolCfwd: r.mainPoolCfwd, specialPoolCfwd: r.specialPoolCfwd },
  };
}

// A trimmed client shape from GET /api/clients (only the fields the wizard uses).
export interface WizardClient {
  id: string;
  name: string;
  client_ref: string | null;
  business_type: string | null;
  contact_email: string | null;
  contact_number?: string | null;
  status?: string | null;
  utr_number?: string | null;
  national_insurance_number?: string | null;
  date_of_birth?: string | null;
  address?: string | null;
}

// ── Per-return-type info panel (mockup step 1, right rail) ────────────────────
export interface ReturnTypeInfo {
  description: string;
  includes: string[];
  sources: { label: string; icon: LucideIcon }[];
  timelineWindow: string;
  lastSubmission: string;
}

export const RETURN_TYPE_INFO: Record<ReturnTypeId, ReturnTypeInfo> = {
  sa100: {
    description: 'Self Assessment return for individuals, sole traders and directors.',
    includes: [
      'Employment, self-employment and property income',
      'Dividends, savings and other income',
      'Capital gains and losses',
      'Pension contributions and reliefs',
      'Student loans and tax adjustments',
    ],
    sources: [
      { label: 'Payroll', icon: Receipt },
      { label: 'Accounts Studio', icon: Calculator },
      { label: 'Landlord Analysis', icon: Home },
      { label: 'Companies House', icon: Building2 },
      { label: 'HMRC', icon: ShieldCheck },
    ],
    timelineWindow: 'January – 31 January',
    lastSubmission: '31 January',
  },
  sa800: {
    description: 'Partnership tax return and partner profit statements.',
    includes: ['Trading income & expenses', 'Partner profit allocation', 'Property & investment income', 'Partnership statements (per partner)'],
    sources: [{ label: 'Accounts Studio', icon: Calculator }, { label: 'Capture', icon: Briefcase }, { label: 'HMRC', icon: ShieldCheck }],
    timelineWindow: 'January – 31 January',
    lastSubmission: '31 January',
  },
  sa900: {
    description: 'Trust or estate tax return and beneficiary reports.',
    includes: ['Trust/estate income', 'Beneficiary allocations', 'Capital gains', 'Reliefs and exemptions'],
    sources: [{ label: 'Accounts Studio', icon: Calculator }, { label: 'HMRC', icon: ShieldCheck }],
    timelineWindow: 'January – 31 January',
    lastSubmission: '31 January',
  },
  ct600: {
    description: 'Corporation Tax return for limited companies.',
    includes: ['Trading profit & CT computation', 'Capital allowances', 'Losses & group relief', 'iXBRL accounts & tax comp'],
    sources: [{ label: 'Accounts Studio', icon: Calculator }, { label: 'Companies House', icon: Building2 }, { label: 'HMRC', icon: ShieldCheck }],
    timelineWindow: '12 months after period end',
    lastSubmission: '12 months after year end',
  },
  cgt: {
    description: 'Report and calculate chargeable gains and losses.',
    includes: ['Disposals of property & shares', 'Acquisition & disposal costs', 'Reliefs (PRR, BADR)', 'Annual exempt amount'],
    sources: [{ label: 'Accounts Studio', icon: Calculator }, { label: 'HMRC', icon: ShieldCheck }],
    timelineWindow: '60 days (property) / with SA100',
    lastSubmission: '31 January',
  },
  non_resident: {
    description: 'Non-resident individual return (SA109 residence pages).',
    includes: ['Residence & domicile status', 'UK-source income', 'Double taxation relief', 'Split-year treatment'],
    sources: [{ label: 'HMRC', icon: ShieldCheck }],
    timelineWindow: 'January – 31 January',
    lastSubmission: '31 January',
  },
};

// ── Client eligibility per return type ───────────────────────────────────────
/** Which client business_types are eligible for a given return type. Empty = all. */
export function businessTypesForReturn(id: ReturnTypeId): string[] {
  switch (id) {
    case 'sa100': return ['individual', 'sole_trader', 'rental_landlord'];
    case 'sa800': return ['partnership', 'llp'];
    case 'ct600': return ['limited_company'];
    case 'sa900': return ['trust'];
    case 'cgt':
    case 'non_resident': return ['individual', 'sole_trader'];
    default: return [];
  }
}

// ── Roll-forward categories (mockup step 3 table) ────────────────────────────
export type RollKey =
  | 'personal' | 'employment' | 'selfEmployment' | 'property' | 'dividends'
  | 'savings' | 'capitalGains' | 'pension' | 'giftAid' | 'other';

export interface RollCategory {
  key: RollKey;
  label: string;
  sub: string;
  /** Whether this category carries figures into the new return's income. */
  mapsToIncome: boolean;
}

export const ROLL_CATEGORIES: RollCategory[] = [
  { key: 'personal',       label: 'Personal details',        sub: 'Name, address, contact details', mapsToIncome: false },
  { key: 'employment',     label: 'Employment',              sub: 'Employers, pay & tax',           mapsToIncome: true },
  { key: 'selfEmployment', label: 'Self employment',         sub: 'Trades & profit',                mapsToIncome: true },
  { key: 'property',       label: 'Rental property',         sub: 'Property income',                mapsToIncome: true },
  { key: 'dividends',      label: 'Dividends',               sub: 'Dividend income',                mapsToIncome: true },
  { key: 'savings',        label: 'Savings & interest',      sub: 'Interest received',              mapsToIncome: true },
  { key: 'capitalGains',   label: 'Capital gains',           sub: 'Disposals',                      mapsToIncome: false },
  { key: 'pension',        label: 'Pension contributions',   sub: 'Personal pension',               mapsToIncome: true },
  { key: 'giftAid',        label: 'Gift Aid donations',      sub: 'Charitable giving',              mapsToIncome: true },
  { key: 'other',          label: 'Other reliefs & deductions', sub: 'Prof subscriptions, etc.',    mapsToIncome: true },
];

/** Does the prior-year income have any data for this category? */
export function categoryHasData(key: RollKey, income: Sa100Income): boolean {
  switch (key) {
    case 'personal': return true;
    case 'employment': return income.employment.length > 0;
    case 'selfEmployment': return income.selfEmployment.length > 0;
    case 'property': return income.property.length > 0;
    case 'dividends': return dividendsTotal(income) > 0;
    case 'savings': return savingsInterestTotal(income) > 0;
    case 'capitalGains': return false; // not modelled in SA100 income yet
    case 'pension': return lineTotal(income.pensionContributionsItems, income.pensionContributions) > 0;
    case 'giftAid': return lineTotal(income.giftAidItems, income.giftAid) > 0;
    case 'other': return (income.otherIncome || 0) > 0;
  }
}

/** Short display of a category's prior-year value. */
export function categoryValueLabel(key: RollKey, income: Sa100Income, fmt: (n: number) => string): string {
  switch (key) {
    case 'personal': return '—';
    case 'employment': return income.employment.length ? fmt(income.employment.reduce((a, e) => a + e.pay, 0)) : '£0';
    case 'selfEmployment': return income.selfEmployment.length ? fmt(income.selfEmployment.reduce((a, s) => a + s.profit, 0)) : '£0';
    case 'property': return income.property.length ? fmt(income.property.reduce((a, p) => a + p.profit, 0)) : '£0';
    case 'dividends': return fmt(dividendsTotal(income));
    case 'savings': return fmt(savingsInterestTotal(income));
    case 'capitalGains': return '£0';
    case 'pension': return fmt(lineTotal(income.pensionContributionsItems, income.pensionContributions));
    case 'giftAid': return fmt(lineTotal(income.giftAidItems, income.giftAid));
    case 'other': return fmt(income.otherIncome || 0);
  }
}

/** A short AI-style note per category (Phase 1: derived from presence of data). */
export function categoryNote(key: RollKey, income: Sa100Income): { text: string; review: boolean } {
  const has = categoryHasData(key, income);
  switch (key) {
    case 'personal': return { text: 'No changes detected', review: false };
    case 'property': return has ? { text: 'Confirm tenancy & finance costs', review: true } : { text: 'None last year', review: false };
    case 'capitalGains': return { text: 'No disposals last year', review: false };
    case 'giftAid': return has ? { text: 'Consider increasing', review: false } : { text: 'None last year', review: false };
    default: return has ? { text: 'Similar to last year', review: false } : { text: 'None last year', review: false };
  }
}

/** Build the new return's income by rolling forward the selected categories. */
export function rollForwardIncome(prior: Sa100Income, selected: Record<RollKey, boolean>): Sa100Income {
  const out = emptyIncome();
  if (selected.employment) out.employment = prior.employment.map(e => ({ ...e }));
  if (selected.selfEmployment) out.selfEmployment = prior.selfEmployment.map(rollTradeForward);
  if (selected.property) out.property = prior.property.map(p => ({ ...p }));
  if (selected.dividends) {
    out.dividends = prior.dividends;
    out.dividendItems = prior.dividendItems?.map(d => ({ ...d }));
    out.otherDividends = prior.otherDividends;
    out.otherDividendsItems = prior.otherDividendsItems?.map(x => ({ ...x }));
    out.foreignDividendsMain = prior.foreignDividendsMain;
    out.foreignDividendsItems = prior.foreignDividendsItems?.map(x => ({ ...x }));
    out.foreignDividendsTax = prior.foreignDividendsTax;
    out.foreignDividendsTaxItems = prior.foreignDividendsTaxItems?.map(x => ({ ...x }));
  }
  if (selected.savings) {
    out.savingsInterest = prior.savingsInterest;
    out.savingsInterestItems = prior.savingsInterestItems?.map(s => ({ ...s }));
    out.taxedInterestItems = prior.taxedInterestItems?.map(t => ({ ...t }));
    out.untaxedForeignInterest = prior.untaxedForeignInterest;
  }
  if (selected.pension) {
    out.pensionContributions = prior.pensionContributions;
    out.pensionContributionsItems = prior.pensionContributionsItems?.map(x => ({ ...x }));
    out.pensionOneOff = prior.pensionOneOff;
    out.pensionRetirementAnnuityItems = prior.pensionRetirementAnnuityItems?.map(x => ({ ...x }));
    out.pensionEmployerSchemeItems = prior.pensionEmployerSchemeItems?.map(x => ({ ...x }));
    out.pensionOverseasItems = prior.pensionOverseasItems?.map(x => ({ ...x }));
  }
  if (selected.giftAid) {
    out.giftAid = prior.giftAid;
    out.giftAidItems = prior.giftAidItems?.map(x => ({ ...x }));
    out.giftAidOneOffItems = prior.giftAidOneOffItems?.map(x => ({ ...x }));
    out.giftAidCarryBackItems = prior.giftAidCarryBackItems?.map(x => ({ ...x }));
    out.giftAidFutureItems = prior.giftAidFutureItems?.map(x => ({ ...x }));
    out.giftAidSharesItems = prior.giftAidSharesItems?.map(x => ({ ...x }));
    out.giftAidLandItems = prior.giftAidLandItems?.map(x => ({ ...x }));
  }
  if (selected.other) {
    out.otherIncome = prior.otherIncome;
    out.otherIncomeItems = prior.otherIncomeItems?.map(x => ({ ...x }));
    out.preOwnedAssetsItems = prior.preOwnedAssetsItems?.map(x => ({ ...x }));
    out.otherIncomeDescription = prior.otherIncomeDescription;
  }
  // Pensions & benefits carry over as a recurring income structure.
  out.pensionsIncome = prior.pensionsIncome;
  out.pensionsIncomeItems = prior.pensionsIncomeItems?.map(x => ({ ...x }));
  out.statePension = prior.statePension;
  out.statePensionItems = prior.statePensionItems?.map(x => ({ ...x }));
  out.statePensionLumpSumItems = prior.statePensionLumpSumItems?.map(x => ({ ...x }));
  out.incapacityBenefit = prior.incapacityBenefit;
  out.jobseekersAllowance = prior.jobseekersAllowance;
  out.otherPensionsBenefits = prior.otherPensionsBenefits;
  out.studentLoanPlan = prior.studentLoanPlan;
  out.postgradLoan = prior.postgradLoan;
  // Standing personal details carry over regardless of category selection.
  out.registeredBlind = prior.registeredBlind;
  out.blindAuthority = prior.blindAuthority;
  out.blindSpouseSurplusClaim = prior.blindSpouseSurplusClaim;
  out.blindSpouseSurplusSurrender = prior.blindSpouseSurplusSurrender;
  out.marriageAllowance = prior.marriageAllowance;
  out.spouseFirstName = prior.spouseFirstName;
  out.spouseLastName = prior.spouseLastName;
  out.spouseNino = prior.spouseNino;
  out.spouseDob = prior.spouseDob;
  out.marriageDate = prior.marriageDate;
  // Finishing your tax return — repayment & adviser details are standing.
  out.repayBankName = prior.repayBankName;
  out.repayAccountHolder = prior.repayAccountHolder;
  out.repaySortCode = prior.repaySortCode;
  out.repayAccountNumber = prior.repayAccountNumber;
  out.repayBuildingSocRef = prior.repayBuildingSocRef;
  out.repayNoUkAccount = prior.repayNoUkAccount;
  out.repayNomineeNameEntered = prior.repayNomineeNameEntered;
  out.repayNomineeIsAdviser = prior.repayNomineeIsAdviser;
  out.repayNomineeAddress = prior.repayNomineeAddress;
  out.repayNomineePostcode = prior.repayNomineePostcode;
  out.adviserName = prior.adviserName;
  out.adviserPhone = prior.adviserPhone;
  out.adviserAddress = prior.adviserAddress;
  out.adviserReference = prior.adviserReference;
  return out;
}

export function entityLabelForBusinessType(bt?: string | null): string {
  const v = (bt ?? '').toLowerCase();
  if (v.includes('sole')) return 'Sole trader';
  if (v.includes('partnership')) return 'Partnership';
  if (v.includes('llp')) return 'LLP';
  if (v.includes('limited')) return 'Limited company';
  if (v.includes('trust')) return 'Trust';
  if (v.includes('landlord')) return 'Landlord';
  return 'Individual';
}
