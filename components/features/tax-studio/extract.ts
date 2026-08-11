// Tax Studio — client-side document extraction (SA100).

import { fileToBase64, readFileAsText, compressImage } from '@/utils/fileUtils';
import { countryLabel } from './countries';
import type { Sa100Income, ForeignRow, ForeignProperty, Sa107, Sa108 } from './types';

/** Which SA106 table a foreign income line belongs to. */
export type ForeignCategory = 'interest' | 'dividends' | 'pension' | 'property' | 'other';
const FOREIGN_CATS = new Set<ForeignCategory>(['interest', 'dividends', 'pension', 'property', 'other']);

/** Which SA107 area a scanned trust/estate income line belongs to. */
export type TrustCategory = 'discretionaryTrust' | 'nonDiscTrust' | 'ukEstate';
const TRUST_CATS = new Set<TrustCategory>(['discretionaryTrust', 'nonDiscTrust', 'ukEstate']);
const TRUST_CAT_LABEL: Record<TrustCategory, string> = {
  discretionaryTrust: 'Discretionary trust income', nonDiscTrust: 'Trust income', ukEstate: 'Estate income',
};

/** Which SA108 asset class a scanned capital-gains line belongs to. */
export type CgtCategory = 'residential' | 'crypto' | 'other' | 'listed' | 'unlisted';
const CGT_CATS = new Set<CgtCategory>(['residential', 'crypto', 'other', 'listed', 'unlisted']);
const CGT_CAT_LABEL: Record<CgtCategory, string> = {
  residential: 'Residential property', crypto: 'Cryptoassets', other: 'Other assets', listed: 'Listed shares', unlisted: 'Unlisted shares',
};
/** SA108 box keys per asset class (disposals / proceeds / costs / gains / losses). */
const CGT_BOX: Record<CgtCategory, { disposals: keyof Sa108; proceeds: keyof Sa108; costs: keyof Sa108; gains: keyof Sa108; losses: keyof Sa108 }> = {
  residential: { disposals: 'resiDisposals', proceeds: 'resiProceeds', costs: 'resiCosts', gains: 'resiGains', losses: 'resiLosses' },
  crypto: { disposals: 'cryptoDisposals', proceeds: 'cryptoProceeds', costs: 'cryptoCosts', gains: 'cryptoGains', losses: 'cryptoLosses' },
  other: { disposals: 'otherDisposals', proceeds: 'otherProceeds', costs: 'otherCosts', gains: 'otherGains', losses: 'otherLosses' },
  listed: { disposals: 'listedDisposals', proceeds: 'listedProceeds', costs: 'listedCosts', gains: 'listedGains', losses: 'listedLosses' },
  unlisted: { disposals: 'unlistedDisposals', proceeds: 'unlistedProceeds', costs: 'unlistedCosts', gains: 'unlistedGains', losses: 'unlistedLosses' },
};

export interface Sa100Extraction {
  documents: { fileName: string; docType: string; summary: string }[];
  employment: { employer: string; pay: number; taxDeducted: number; benefits: number; expenses: number }[];
  // Self-employment (SA103) — the figures a set of accounts provides.
  selfEmployment: { name: string; turnover: number; expenses: number; netProfit: number; capitalAllowances: number; cis: number }[];
  // Partnership (SA104) — this partner's share + any tax/CIS taken off.
  partnerships: { name: string; profit: number; taxTaken: number; cis: number }[];
  // UK property (SA105) — rents and the allowable-expense buckets, per property.
  property: { address: string; rents: number; expPremises: number; expRepairs: number; expFinance: number; expProfessional: number; expOther: number; netProfit: number; residential: boolean }[];
  dividends: number;
  /** Each dividend listed separately (one per voucher/company). */
  dividendList: { company: string; description?: string; amount: number }[];
  savingsInterest: number;
  /** Taxed UK interest received net, with tax deducted (SA100 box 1). */
  taxedInterestList: { description?: string; net: number; tax: number }[];
  pensionsIncome: number;
  statePension: number;
  /** Foreign income lines (SA106), each routed to the right table by category. */
  foreignItems: { country: string; category: ForeignCategory; income: number; foreignTax: number }[];
  foreignDividends: number;    // box 6 — foreign dividends (≤ £500) on the main return
  foreignDividendsTax: number; // box 7 — tax taken off those
  /** Trust / estate income lines (SA107), each routed to the right area. */
  trustEstate: { source: string; category: TrustCategory; nonSavings: number; savings: number; dividend: number }[];
  /** Capital-gains disposal groups (SA108), one per asset class. */
  capitalGains: { category: CgtCategory; disposals: number; proceeds: number; costs: number; gains: number; losses: number }[];
  otherIncome: number;
  giftAid: number;
  pensionContributions: number;
  childBenefit: number;
  notes: string[];
  /** SA109 residence facts evidenced by a document (P85, certificate of residence,
   *  travel record, DTA claim, etc.). Empty/undefined when nothing relevant found. */
  residence?: {
    notResident: boolean; splitYear: boolean; residentLastYear: boolean; homeOverseas: boolean;
    daysInUk: number; daysExceptional: number; daysTransit: number; ukTies: number; workdaysUk: number; workdaysOverseas: number;
    arrivalDate: string; nationalResidentCountries: string; residentCountryCodes: string;
    figIncomeClaim: boolean; figGainsClaim: boolean;
    dtaIncomeReliefAmount: number; dtaReliefResidence: number; dtaReliefOther: number;
  };
  /** SA101 Additional-information figures evidenced by a document — a chargeable-
   *  event certificate, an EIS3/SEIS3/VCT3 certificate, a pension savings
   *  statement, a redundancy/settlement statement, a gilt interest statement, etc.
   *  Empty/undefined when nothing relevant found. */
  additional?: {
    giltInterestNet: number; giltTaxTaken: number; giltGross: number;
    lifeGain: number; lifeGainYears: number; lifeGainUkPolicy: boolean; lifeGainNoTaxPaid: number;
    voidedIsaGain: number; voidedIsaTax: number;
    stockDividends: number;
    redundancy: number; taxableLumpSums: number; taxOffLumpSums: number; lumpSumExemption30k: number;
    eisSubscriptions: number; seisSubscriptions: number; vctSubscriptions: number; citrInvestment: number;
    annualAllowanceExcess: number; annualAllowanceTaxPaid: number;
    businessReceipts: number;
  };
  /** SA102 Northern Ireland Legislative Assembly office figures evidenced by a
   *  document (a P60/P45 for the Assembly office, an Office Cost Expenditure
   *  statement, etc.). Empty/undefined when nothing relevant found. */
  niAssembly?: {
    p60Pay: number; payrolledBenefitsStudentLoan: number; taxTakenOff: number;
    officeCostExpenditure: number; otherCashReimbursements: number; allOtherBenefits: number; balancingCharges: number;
    secretarialAssistance: number; officeExpenses: number; otherExpensesCapitalAllowances: number;
  };
  /** SA102 Members of Parliament (MPs) office figures evidenced by a document
   *  (a P60/P45 for the Parliamentary office, an Office Costs Expenditure or
   *  IPSA statement, etc.). Empty/undefined when nothing relevant found. */
  parliament?: {
    p60Pay: number; payrolledBenefitsStudentLoan: number; taxTakenOff: number;
    travelVouchers: number; accommodation: number; officeCostsExpenditure: number; contingencyPayment: number; financialAssistanceFund: number; allOtherBenefits: number; balancingCharges: number;
    travelWarrants: number; secretarialAssistance: number; officeExpenses: number; otherExpensesCapitalAllowances: number;
  };
  /** Documents/figures found but NOT used, each with a plain-English reason. */
  setAside: { label: string; reason: string }[];
  /** Missing documents or context SMITH would need to make entries accurate. */
  needs: string[];
}

export interface EncodedFile { name: string; mimeType: string; base64?: string; text?: string }

/** Encode a File for the extract API — images are compressed, PDFs base64'd,
 *  CSV/plain text read as text. */
export async function encodeFile(file: File): Promise<EncodedFile> {
  const isText = file.type === 'text/csv' || file.type === 'text/plain' || /\.(csv|txt)$/i.test(file.name);
  if (isText) return { name: file.name, mimeType: file.type || 'text/plain', text: await readFileAsText(file) };
  const isImage = file.type.startsWith('image/');
  const f = isImage ? await compressImage(file) : file;
  return { name: file.name, mimeType: f.type || file.type || 'application/octet-stream', base64: await fileToBase64(f) };
}

/** Empty-but-shaped extraction, used as a resilient default when the AI omits fields. */
function normalise(raw: unknown): Sa100Extraction {
  const e = (raw ?? {}) as Partial<Sa100Extraction> & { selfEmployment?: { profit?: number }[]; property?: { profit?: number }[] };
  const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? v as T[] : []);
  const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  const str = (v: unknown): string | undefined => (v != null ? String(v) : undefined);
  const cat = (v: unknown): ForeignCategory => (FOREIGN_CATS.has(v as ForeignCategory) ? v as ForeignCategory : 'other');
  const tcat = (v: unknown): TrustCategory => (TRUST_CATS.has(v as TrustCategory) ? v as TrustCategory : 'ukEstate');
  const ccat = (v: unknown): CgtCategory => (CGT_CATS.has(v as CgtCategory) ? v as CgtCategory : 'other');
  return {
    documents: arr(e.documents),
    employment: arr<Sa100Extraction['employment'][number]>(e.employment).map(x => ({ employer: String(x?.employer ?? ''), pay: num(x?.pay), taxDeducted: num(x?.taxDeducted), benefits: num(x?.benefits), expenses: num(x?.expenses) })),
    selfEmployment: arr<Sa100Extraction['selfEmployment'][number] & { profit?: number }>(e.selfEmployment).map(x => ({ name: String(x?.name ?? ''), turnover: num(x?.turnover), expenses: num(x?.expenses), netProfit: num(x?.netProfit ?? x?.profit), capitalAllowances: num(x?.capitalAllowances), cis: num(x?.cis) })),
    partnerships: arr<Sa100Extraction['partnerships'][number]>(e.partnerships).map(x => ({ name: String(x?.name ?? ''), profit: num(x?.profit), taxTaken: num(x?.taxTaken), cis: num(x?.cis) })),
    property: arr<Sa100Extraction['property'][number] & { profit?: number }>(e.property).map(x => ({ address: String(x?.address ?? ''), rents: num(x?.rents), expPremises: num(x?.expPremises), expRepairs: num(x?.expRepairs), expFinance: num(x?.expFinance), expProfessional: num(x?.expProfessional), expOther: num(x?.expOther), netProfit: num(x?.netProfit ?? x?.profit), residential: x?.residential !== false })),
    dividendList: arr<Sa100Extraction['dividendList'][number]>(e.dividendList).map(x => ({ company: String(x?.company ?? ''), description: str(x?.description), amount: num(x?.amount) })).filter(x => x.amount > 0),
    dividends: num(e.dividends), savingsInterest: num(e.savingsInterest),
    taxedInterestList: arr<Sa100Extraction['taxedInterestList'][number]>(e.taxedInterestList).map(x => ({ description: str(x?.description), net: num(x?.net), tax: num(x?.tax) })).filter(x => x.net > 0 || x.tax > 0),
    pensionsIncome: num(e.pensionsIncome), statePension: num(e.statePension),
    foreignItems: arr<Sa100Extraction['foreignItems'][number]>(e.foreignItems).map(x => ({ country: String(x?.country ?? ''), category: cat(x?.category), income: num(x?.income), foreignTax: num(x?.foreignTax) })).filter(x => x.income > 0 || x.foreignTax > 0),
    foreignDividends: num(e.foreignDividends), foreignDividendsTax: num(e.foreignDividendsTax),
    trustEstate: arr<Sa100Extraction['trustEstate'][number]>(e.trustEstate).map(x => ({ source: String(x?.source ?? ''), category: tcat(x?.category), nonSavings: num(x?.nonSavings), savings: num(x?.savings), dividend: num(x?.dividend) })).filter(x => x.nonSavings > 0 || x.savings > 0 || x.dividend > 0),
    capitalGains: arr<Sa100Extraction['capitalGains'][number]>(e.capitalGains).map(x => ({ category: ccat(x?.category), disposals: num(x?.disposals), proceeds: num(x?.proceeds), costs: num(x?.costs), gains: num(x?.gains), losses: num(x?.losses) })).filter(x => x.gains > 0 || x.losses > 0 || x.proceeds > 0),
    otherIncome: num(e.otherIncome), giftAid: num(e.giftAid), pensionContributions: num(e.pensionContributions),
    childBenefit: num(e.childBenefit), notes: arr<string>(e.notes),
    residence: normResidence(e.residence),
    additional: normAdditional(e.additional),
    niAssembly: normNiAssembly(e.niAssembly),
    parliament: normParliament(e.parliament),
    setAside: arr<Sa100Extraction['setAside'][number]>(e.setAside).map(x => ({ label: String(x?.label ?? ''), reason: String(x?.reason ?? '') })).filter(x => x.label || x.reason),
    needs: arr<string>(e.needs).map(String).filter(Boolean),
  };
}

// Normalise scanned SA101 figures — undefined when nothing relevant was found.
function normAdditional(raw: unknown): Sa100Extraction['additional'] {
  const r = (raw ?? {}) as Record<string, unknown>;
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  const b = (v: unknown) => v === true;
  const a = {
    giltInterestNet: n(r.giltInterestNet), giltTaxTaken: n(r.giltTaxTaken), giltGross: n(r.giltGross),
    lifeGain: n(r.lifeGain), lifeGainYears: n(r.lifeGainYears), lifeGainUkPolicy: b(r.lifeGainUkPolicy), lifeGainNoTaxPaid: n(r.lifeGainNoTaxPaid),
    voidedIsaGain: n(r.voidedIsaGain), voidedIsaTax: n(r.voidedIsaTax),
    stockDividends: n(r.stockDividends),
    redundancy: n(r.redundancy), taxableLumpSums: n(r.taxableLumpSums), taxOffLumpSums: n(r.taxOffLumpSums), lumpSumExemption30k: n(r.lumpSumExemption30k),
    eisSubscriptions: n(r.eisSubscriptions), seisSubscriptions: n(r.seisSubscriptions), vctSubscriptions: n(r.vctSubscriptions), citrInvestment: n(r.citrInvestment),
    annualAllowanceExcess: n(r.annualAllowanceExcess), annualAllowanceTaxPaid: n(r.annualAllowanceTaxPaid),
    businessReceipts: n(r.businessReceipts),
  };
  const any = Object.values(a).some(v => (typeof v === 'number' ? v !== 0 : v));
  return any ? a : undefined;
}

// Normalise scanned NI Assembly office figures — undefined when nothing relevant.
function normNiAssembly(raw: unknown): Sa100Extraction['niAssembly'] {
  const r = (raw ?? {}) as Record<string, unknown>;
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  const a = {
    p60Pay: n(r.p60Pay), payrolledBenefitsStudentLoan: n(r.payrolledBenefitsStudentLoan), taxTakenOff: n(r.taxTakenOff),
    officeCostExpenditure: n(r.officeCostExpenditure), otherCashReimbursements: n(r.otherCashReimbursements), allOtherBenefits: n(r.allOtherBenefits), balancingCharges: n(r.balancingCharges),
    secretarialAssistance: n(r.secretarialAssistance), officeExpenses: n(r.officeExpenses), otherExpensesCapitalAllowances: n(r.otherExpensesCapitalAllowances),
  };
  const any = Object.values(a).some(v => v !== 0);
  return any ? a : undefined;
}

// Normalise scanned MPs office figures — undefined when nothing relevant.
function normParliament(raw: unknown): Sa100Extraction['parliament'] {
  const r = (raw ?? {}) as Record<string, unknown>;
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  const a = {
    p60Pay: n(r.p60Pay), payrolledBenefitsStudentLoan: n(r.payrolledBenefitsStudentLoan), taxTakenOff: n(r.taxTakenOff),
    travelVouchers: n(r.travelVouchers), accommodation: n(r.accommodation), officeCostsExpenditure: n(r.officeCostsExpenditure), contingencyPayment: n(r.contingencyPayment), financialAssistanceFund: n(r.financialAssistanceFund), allOtherBenefits: n(r.allOtherBenefits), balancingCharges: n(r.balancingCharges),
    travelWarrants: n(r.travelWarrants), secretarialAssistance: n(r.secretarialAssistance), officeExpenses: n(r.officeExpenses), otherExpensesCapitalAllowances: n(r.otherExpensesCapitalAllowances),
  };
  const any = Object.values(a).some(v => v !== 0);
  return any ? a : undefined;
}

// Normalise scanned residence facts — returns undefined when nothing was found so
// the merge never touches the SA109 page for an unrelated document.
function normResidence(raw: unknown): Sa100Extraction['residence'] {
  const r = (raw ?? {}) as Record<string, unknown>;
  const b = (v: unknown) => v === true;
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  const s = (v: unknown) => (v != null ? String(v).trim() : '');
  const res = {
    notResident: b(r.notResident), splitYear: b(r.splitYear), residentLastYear: b(r.residentLastYear), homeOverseas: b(r.homeOverseas),
    daysInUk: n(r.daysInUk), daysExceptional: n(r.daysExceptional), daysTransit: n(r.daysTransit), ukTies: n(r.ukTies), workdaysUk: n(r.workdaysUk), workdaysOverseas: n(r.workdaysOverseas),
    arrivalDate: s(r.arrivalDate), nationalResidentCountries: s(r.nationalResidentCountries), residentCountryCodes: s(r.residentCountryCodes),
    figIncomeClaim: b(r.figIncomeClaim), figGainsClaim: b(r.figGainsClaim),
    dtaIncomeReliefAmount: n(r.dtaIncomeReliefAmount), dtaReliefResidence: n(r.dtaReliefResidence), dtaReliefOther: n(r.dtaReliefOther),
  };
  const any = Object.values(res).some(v => (typeof v === 'number' ? v !== 0 : typeof v === 'boolean' ? v : !!v));
  return any ? res : undefined;
}

export async function fetchExtraction(taxYear: string, files: EncodedFile[]): Promise<Sa100Extraction> {
  const r = await fetch('/api/tax-studio/extract', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ taxYear, files }),
  });
  const ct = r.headers.get('content-type') ?? '';
  const d = ct.includes('application/json') ? await r.json().catch(() => ({})) : {};
  if (!r.ok) throw new Error((d as { error?: string }).error ?? 'Could not read the documents.');
  return normalise((d as { extraction?: unknown }).extraction);
}

/** True if the extraction found anything importable. */
export function extractionHasData(e: Sa100Extraction): boolean {
  return e.employment.length > 0 || e.selfEmployment.length > 0 || e.partnerships.length > 0 || e.property.length > 0
    || e.foreignItems.length > 0 || e.taxedInterestList.length > 0 || e.dividendList.length > 0 || e.trustEstate.length > 0 || e.capitalGains.length > 0
    || [e.dividends, e.savingsInterest, e.pensionsIncome, e.statePension, e.foreignDividends, e.otherIncome, e.giftAid, e.pensionContributions, e.childBenefit].some(n => n > 0);
}

// ── Scan-review proposals (the editable left panel of the review lightbox) ─────
export type ScanDest =
  | 'employment' | 'selfEmployment' | 'partnership' | 'property' | 'dividends'
  | 'savingsInterest' | 'pensionsIncome' | 'statePension' | 'foreign' | 'trusts' | 'cgt' | 'giftAid'
  | 'pensionContributions' | 'otherIncome' | 'childBenefit' | 'exclude';

/** The destinations a scanned figure can be sent to (the reassignment dropdown). */
export const SCAN_DESTS: { value: ScanDest; label: string }[] = [
  { value: 'employment', label: 'Employment (SA102)' },
  { value: 'selfEmployment', label: 'Self-employment (SA103)' },
  { value: 'partnership', label: 'Partnership (SA104)' },
  { value: 'property', label: 'UK property (SA105)' },
  { value: 'foreign', label: 'Foreign income (SA106)' },
  { value: 'trusts', label: 'Trusts & estates (SA107)' },
  { value: 'cgt', label: 'Capital gains (SA108)' },
  { value: 'dividends', label: 'Dividends' },
  { value: 'savingsInterest', label: 'Savings interest' },
  { value: 'pensionsIncome', label: 'Pension income' },
  { value: 'statePension', label: 'State pension' },
  { value: 'giftAid', label: 'Gift Aid' },
  { value: 'pensionContributions', label: 'Pension contributions' },
  { value: 'otherIncome', label: 'Other income' },
  { value: 'childBenefit', label: 'Child benefit' },
  { value: 'exclude', label: '— Don’t import' },
];
const DEST_LABEL = new Map(SCAN_DESTS.map(d => [d.value, d.label]));
export const scanDestLabel = (d: ScanDest): string => DEST_LABEL.get(d) ?? d;

/** Fields that are a deduction, credit or tax withheld — listed and editable but
 *  NOT part of the headline "income brought on" total (e.g. PAYE tax, expenses). */
const NON_INCOME_FIELDS = new Set(['taxDeducted', 'expenses', 'capitalAllowances', 'cis', 'taxTaken', 'expPremises', 'expRepairs', 'expFinance', 'expProfessional', 'expOther', 'foreignTax', 'cgtProceeds', 'cgtCosts', 'cgtLosses']);
/** True when a proposal's figure is income (counts toward the headline total). */
export const isIncomeField = (field?: string): boolean => !field || !NON_INCOME_FIELDS.has(field);

/** Extra context carried on a grouped source's primary row (drives reassembly). */
export interface ScanProposalMeta { name?: string; address?: string; residential?: boolean; country?: string; category?: ForeignCategory; trustCategory?: TrustCategory; cgtCategory?: CgtCategory; cgtDisposals?: number }

/** One editable proposed entry on the review lightbox's left panel. */
export interface ScanProposal {
  id: string;
  label: string;
  amount: number;
  dest: ScanDest;
  origin: ScanDest;   // where it was first proposed (drives the "reassigned" cue)
  emp?: Sa100Extraction['employment'][number]; // rich P60/P11D data preserved for employment
  group?: string;     // links a source's figures (income + its companions) into one section record
  field?: string;     // which box this figure feeds within its section group
  primary?: boolean;  // the group's headline row — carries the section dropdown + meta
  meta?: ScanProposalMeta; // source context (name/address/country/category) on the primary row
}

const FOREIGN_CAT_LABEL: Record<ForeignCategory, string> = {
  interest: 'Foreign interest', dividends: 'Foreign dividends', pension: 'Foreign pension',
  property: 'Foreign property income', other: 'Foreign income',
};

let _pid = 0;
const pid = () => `sp-${Date.now()}-${_pid++}`;

/** One figure within a grouped source: which box it feeds, its label and amount. */
interface FieldSpec { field: string; label: string; amount: number; primary?: boolean }

/** Turn a raw extraction into editable proposals (each figure → its destination).
 *  Sections that come from a single source document (employment, self-employment,
 *  partnership, property, a foreign line) are emitted as a GROUP: a primary income
 *  row carrying the destination dropdown, plus indented companion rows for the
 *  deductions/credits found (tax, expenses, capital allowances) — bound to the
 *  same record so nothing found is hidden and nothing can be misrouted. */
export function buildScanProposals(e: Sa100Extraction): ScanProposal[] {
  const out: ScanProposal[] = [];
  // Emit one group: the primary row + any non-zero companion rows.
  const pushGroup = (dest: ScanDest, meta: ScanProposalMeta, specs: FieldSpec[], emp?: Sa100Extraction['employment'][number]) => {
    const group = pid();
    specs.forEach(s => {
      if (!s.amount && !s.primary) return; // drop empty companions; always keep the primary
      out.push({ id: pid(), label: s.label, amount: Math.round(s.amount || 0), dest, origin: dest, group, field: s.field, primary: !!s.primary, meta: s.primary ? meta : undefined, emp: s.primary ? emp : undefined });
    });
  };
  const push = (label: string, amount: number, dest: ScanDest) => {
    if (amount) out.push({ id: pid(), label, amount: Math.round(amount), dest, origin: dest });
  };

  // Employment — pay + PAYE tax + benefits + expenses.
  e.employment.forEach(x => {
    const who = x.employer || 'employment';
    pushGroup('employment', { name: who }, [
      { field: 'pay', label: `Pay — ${who}`, amount: x.pay, primary: true },
      { field: 'taxDeducted', label: `PAYE tax deducted — ${who}`, amount: x.taxDeducted },
      { field: 'benefits', label: `Benefits in kind — ${who}`, amount: x.benefits },
      { field: 'expenses', label: `Employment expenses — ${who}`, amount: x.expenses },
    ], x);
  });

  // Self-employment — turnover + expenses + capital allowances + CIS, else net profit.
  e.selfEmployment.forEach(x => {
    const who = x.name || 'self-employment';
    const useTurnover = x.turnover > 0;
    pushGroup('selfEmployment', { name: who }, [
      useTurnover
        ? { field: 'turnover', label: `Turnover — ${who}`, amount: x.turnover, primary: true }
        : { field: 'netProfit', label: `Net profit — ${who}`, amount: x.netProfit, primary: true },
      ...(useTurnover ? [{ field: 'expenses', label: `Allowable expenses — ${who}`, amount: x.expenses }] : []),
      { field: 'capitalAllowances', label: `Capital allowances — ${who}`, amount: x.capitalAllowances },
      { field: 'cis', label: `CIS deducted — ${who}`, amount: x.cis },
    ]);
  });

  // Partnership — share of profit + tax taken off + CIS.
  e.partnerships.forEach(x => {
    const who = x.name || 'partnership';
    pushGroup('partnership', { name: who }, [
      { field: 'profit', label: `Share of profit — ${who}`, amount: x.profit, primary: true },
      { field: 'taxTaken', label: `Tax taken off — ${who}`, amount: x.taxTaken },
      { field: 'cis', label: `CIS deducted — ${who}`, amount: x.cis },
    ]);
  });

  // UK property — rents + expense buckets, else net profit.
  e.property.forEach(x => {
    const who = x.address || 'property';
    const useRents = x.rents > 0;
    pushGroup('property', { address: who, residential: x.residential }, [
      useRents
        ? { field: 'rents', label: `Rents received — ${who}`, amount: x.rents, primary: true }
        : { field: 'netProfit', label: `Rental profit — ${who}`, amount: x.netProfit, primary: true },
      ...(useRents ? [
        { field: 'expPremises', label: `Rent, rates, insurance — ${who}`, amount: x.expPremises },
        { field: 'expRepairs', label: `Repairs & maintenance — ${who}`, amount: x.expRepairs },
        { field: 'expFinance', label: `Finance costs — ${who}`, amount: x.expFinance },
        { field: 'expProfessional', label: `Professional fees — ${who}`, amount: x.expProfessional },
        { field: 'expOther', label: `Other expenses — ${who}`, amount: x.expOther },
      ] : []),
    ]);
  });

  // Foreign — each line = income + its foreign tax, routed to the right SA106 table.
  e.foreignItems.forEach(x => {
    const c = x.country ? countryLabel(x.country) : 'foreign';
    pushGroup('foreign', { country: x.country, category: x.category }, [
      { field: 'foreignIncome', label: `${FOREIGN_CAT_LABEL[x.category]} — ${c}`, amount: x.income, primary: true },
      { field: 'foreignTax', label: `Foreign tax — ${c}`, amount: x.foreignTax },
    ]);
  });

  // Trusts & estates (SA107) — income by type, routed to the right area.
  e.trustEstate.forEach(x => {
    const who = x.source || 'trust / estate';
    pushGroup('trusts', { name: who, trustCategory: x.category }, [
      { field: 'trustNonSavings', label: `${TRUST_CAT_LABEL[x.category]} — ${who}`, amount: x.nonSavings, primary: true },
      { field: 'trustSavings', label: `Savings income — ${who}`, amount: x.savings },
      { field: 'trustDividend', label: `Dividend income — ${who}`, amount: x.dividend },
    ]);
  });

  // Capital gains (SA108) — one group per asset class (gains + proceeds/costs/losses).
  e.capitalGains.forEach(x => {
    const lbl = CGT_CAT_LABEL[x.category];
    pushGroup('cgt', { name: lbl, cgtCategory: x.category, cgtDisposals: x.disposals }, [
      { field: 'cgtGains', label: `${lbl} — gains`, amount: x.gains, primary: true },
      { field: 'cgtProceeds', label: `Proceeds — ${lbl}`, amount: x.proceeds },
      { field: 'cgtCosts', label: `Allowable costs — ${lbl}`, amount: x.costs },
      { field: 'cgtLosses', label: `Losses — ${lbl}`, amount: x.losses },
    ]);
  });

  // Interest & dividends and the reliefs — scalar / itemised income lines.
  if (e.dividendList.length) e.dividendList.forEach(x => push(`Dividend — ${x.company || 'company'}`, x.amount, 'dividends'));
  else if (e.dividends) push('Dividends', e.dividends, 'dividends');
  e.taxedInterestList.forEach(x => {
    const who = x.description || 'account';
    pushGroup('savingsInterest', { name: who }, [
      { field: 'taxedInterestNet', label: `Taxed interest — ${who}`, amount: x.net, primary: true },
      { field: 'taxDeducted', label: `Tax deducted — ${who}`, amount: x.tax },
    ]);
  });
  if (e.savingsInterest) push('Savings interest', e.savingsInterest, 'savingsInterest');
  if (e.foreignDividends) {
    pushGroup('dividends', { category: 'dividends' }, [
      { field: 'foreignDividends', label: 'Foreign dividends (≤ £500)', amount: e.foreignDividends, primary: true },
      { field: 'foreignTax', label: 'Tax on foreign dividends', amount: e.foreignDividendsTax },
    ]);
  }
  if (e.pensionsIncome) push('Pension income', e.pensionsIncome, 'pensionsIncome');
  if (e.statePension) push('State pension', e.statePension, 'statePension');
  if (e.otherIncome) push('Other income', e.otherIncome, 'otherIncome');
  if (e.giftAid) push('Gift Aid', e.giftAid, 'giftAid');
  if (e.pensionContributions) push('Pension contributions', e.pensionContributions, 'pensionContributions');
  if (e.childBenefit) push('Child benefit', e.childBenefit, 'childBenefit');
  return out;
}

function emptyExtraction(): Sa100Extraction {
  return { documents: [], employment: [], selfEmployment: [], partnerships: [], property: [], dividends: 0, dividendList: [], savingsInterest: 0, taxedInterestList: [], pensionsIncome: 0, statePension: 0, foreignItems: [], foreignDividends: 0, foreignDividendsTax: 0, trustEstate: [], capitalGains: [], otherIncome: 0, giftAid: 0, pensionContributions: 0, childBenefit: 0, notes: [], setAside: [], needs: [] };
}

// ── Ask-SMITH chat (Phase 2) — proposed edits the user applies one-click ──────
export interface ScanEdit {
  action: 'add' | 'edit' | 'exclude';
  target?: string;   // label of an existing proposal (edit/exclude)
  label?: string;
  amount?: number;
  dest?: ScanDest;
  reason?: string;   // shown on the Apply chip
}
export interface ScanChatMessage { role: 'user' | 'assistant'; content: string; edits?: ScanEdit[] }

const VALID_DESTS = new Set(SCAN_DESTS.map(d => d.value));
function coerceDest(d: unknown): ScanDest { return typeof d === 'string' && VALID_DESTS.has(d as ScanDest) ? d as ScanDest : 'otherIncome'; }

/** Apply one SMITH-proposed edit to the current proposals (returns a new list). */
export function applyScanEdit(proposals: ScanProposal[], edit: ScanEdit): ScanProposal[] {
  if (edit.action === 'add') {
    const dest = coerceDest(edit.dest);
    return [...proposals, { id: pid(), label: edit.label || 'Added by SMITH', amount: Math.round(edit.amount || 0), dest, origin: dest }];
  }
  return proposals.map(p => {
    if (p.label !== edit.target) return p;
    if (edit.action === 'exclude') return { ...p, dest: 'exclude' };
    return { ...p, amount: edit.amount != null ? Math.round(edit.amount) : p.amount, dest: edit.dest ? coerceDest(edit.dest) : p.dest, label: edit.label || p.label };
  });
}

/** One turn of the scan-review chat. Returns SMITH's reply + proposed edits. */
export async function fetchScanChat(payload: {
  taxYear: string;
  documents: { docType: string; summary: string }[];
  proposals: { label: string; amount: number; dest: string }[];
  setAside: { label: string; reason: string }[];
  needs: string[];
  messages: { role: 'user' | 'assistant'; content: string }[];
}): Promise<{ reply: string; edits: ScanEdit[] }> {
  const r = await fetch('/api/tax-studio/scan-chat', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
  });
  const ct = r.headers.get('content-type') ?? '';
  const d = ct.includes('application/json') ? await r.json().catch(() => ({})) : {};
  if (!r.ok) throw new Error((d as { error?: string }).error ?? 'SMITH is unavailable right now.');
  const edits = Array.isArray((d as { edits?: unknown }).edits) ? ((d as { edits: ScanEdit[] }).edits) : [];
  return { reply: String((d as { reply?: string }).reply ?? ''), edits };
}

/** Apply the (edited) proposals to the income — routes each to its chosen
 *  destination and merges additively (batch-keyed, like a normal scan import). */
export function applyScanProposals(income: Sa100Income, proposals: ScanProposal[], batchId: string): Sa100Income {
  const e = emptyExtraction();

  // Reassemble grouped sources — each source's included figure rows become one
  // record, so pay+tax, turnover+expenses+CAs, rents+expense buckets etc. land in
  // the right boxes together. Excluded rows drop out (field = 0); a row reassigned
  // to another section falls through to the loose pass under its new destination.
  const groupsBySection = new Map<ScanDest, Map<string, ScanProposal[]>>();
  for (const p of proposals) {
    if (!p.group || p.dest === 'exclude') continue;
    let byGroup = groupsBySection.get(p.dest);
    if (!byGroup) groupsBySection.set(p.dest, byGroup = new Map());
    const g = byGroup.get(p.group); if (g) g.push(p); else byGroup.set(p.group, [p]);
  }
  const fieldsOf = (rows: ScanProposal[]): Record<string, number> => { const m: Record<string, number> = {}; for (const r of rows) m[r.field || 'primary'] = Math.round(r.amount || 0); return m; };
  const metaOf = (rows: ScanProposal[]): ScanProposalMeta => rows.find(r => r.primary)?.meta ?? {};
  const each = (section: ScanDest, fn: (f: Record<string, number>, meta: ScanProposalMeta, rows: ScanProposal[]) => void) => {
    const byGroup = groupsBySection.get(section); if (!byGroup) return;
    for (const rows of byGroup.values()) fn(fieldsOf(rows), metaOf(rows), rows);
  };

  each('employment', (f, meta, rows) => {
    const emp = rows.find(r => r.primary)?.emp;
    e.employment.push({ employer: emp?.employer || meta.name || 'Employment', pay: f.pay || 0, taxDeducted: f.taxDeducted || 0, benefits: f.benefits || 0, expenses: f.expenses || 0 });
  });
  each('selfEmployment', (f, meta) => e.selfEmployment.push({ name: meta.name || 'Self-employment', turnover: f.turnover || 0, expenses: f.expenses || 0, netProfit: f.netProfit || 0, capitalAllowances: f.capitalAllowances || 0, cis: f.cis || 0 }));
  each('partnership', (f, meta) => e.partnerships.push({ name: meta.name || 'Partnership', profit: f.profit || 0, taxTaken: f.taxTaken || 0, cis: f.cis || 0 }));
  each('property', (f, meta) => e.property.push({ address: meta.address || 'Property', rents: f.rents || 0, expPremises: f.expPremises || 0, expRepairs: f.expRepairs || 0, expFinance: f.expFinance || 0, expProfessional: f.expProfessional || 0, expOther: f.expOther || 0, netProfit: f.netProfit || 0, residential: meta.residential !== false }));
  each('foreign', (f, meta) => e.foreignItems.push({ country: meta.country || '', category: meta.category || 'other', income: f.foreignIncome || 0, foreignTax: f.foreignTax || 0 }));
  each('trusts', (f, meta) => e.trustEstate.push({ source: meta.name || 'Trust / estate', category: meta.trustCategory || 'ukEstate', nonSavings: f.trustNonSavings || 0, savings: f.trustSavings || 0, dividend: f.trustDividend || 0 }));
  each('cgt', (f, meta) => e.capitalGains.push({ category: meta.cgtCategory || 'other', disposals: meta.cgtDisposals || 0, proceeds: f.cgtProceeds || 0, costs: f.cgtCosts || 0, gains: f.cgtGains || 0, losses: f.cgtLosses || 0 }));
  each('savingsInterest', (f, meta) => { if (f.taxedInterestNet != null || f.taxDeducted != null) e.taxedInterestList.push({ description: meta.name, net: f.taxedInterestNet || 0, tax: f.taxDeducted || 0 }); });
  each('dividends', f => { e.foreignDividends += f.foreignDividends || 0; e.foreignDividendsTax += f.foreignTax || 0; });

  // Loose (ungrouped) rows — scalars, reassigned or chat-added figures.
  for (const p of proposals) {
    if (p.group || p.dest === 'exclude') continue;
    const amt = Math.round(p.amount || 0);
    switch (p.dest) {
      case 'employment': e.employment.push({ employer: p.label, pay: amt, taxDeducted: 0, benefits: 0, expenses: 0 }); break;
      case 'selfEmployment': e.selfEmployment.push({ name: p.label, turnover: 0, expenses: 0, netProfit: amt, capitalAllowances: 0, cis: 0 }); break;
      case 'partnership': e.partnerships.push({ name: p.label, profit: amt, taxTaken: 0, cis: 0 }); break;
      case 'property': e.property.push({ address: p.label, rents: 0, expPremises: 0, expRepairs: 0, expFinance: 0, expProfessional: 0, expOther: 0, netProfit: amt, residential: true }); break;
      case 'foreign': e.foreignItems.push({ country: '', category: 'other', income: amt, foreignTax: 0 }); break;
      case 'trusts': e.trustEstate.push({ source: p.label, category: 'ukEstate', nonSavings: amt, savings: 0, dividend: 0 }); break;
      case 'cgt': e.capitalGains.push({ category: 'other', disposals: 0, proceeds: 0, costs: 0, gains: amt, losses: 0 }); break;
      case 'dividends': e.dividendList.push({ company: p.label, amount: amt }); e.dividends += amt; break;
      case 'savingsInterest': e.savingsInterest += amt; break;
      case 'pensionsIncome': e.pensionsIncome += amt; break;
      case 'statePension': e.statePension += amt; break;
      case 'giftAid': e.giftAid += amt; break;
      case 'pensionContributions': e.pensionContributions += amt; break;
      case 'otherIncome': e.otherIncome += amt; break;
      case 'childBenefit': e.childBenefit += amt; break;
    }
  }
  return mergeExtractionIntoIncome(income, e, batchId);
}

const DOC_EMP = 'doc-emp-', DOC_SE = 'doc-se-', DOC_PT = 'doc-pt-', DOC_PROP = 'doc-prop-', DOC_DV = 'doc-dv-', DOC_TI = 'doc-ti-', DOC_XF = 'doc-xf-';

/** Merge extracted figures into the income. Each scan is its own BATCH, keyed by
 *  `batchId`: re-importing the same scan replaces only that batch's rows (so a
 *  double-click can't duplicate), while a separate scan ADDS its rows without
 *  touching earlier scans or hand-typed rows — so scanning a forgotten P60 later
 *  is additive, never destructive. Scalar fields are set only when the documents
 *  found a value (never wiping a manual figure with a zero). */
export function mergeExtractionIntoIncome(income: Sa100Income, e: Sa100Extraction, batchId: string): Sa100Income {
  const empPfx = `${DOC_EMP}${batchId}-`, sePfx = `${DOC_SE}${batchId}-`, ptPfx = `${DOC_PT}${batchId}-`, propPfx = `${DOC_PROP}${batchId}-`, dvPfx = `${DOC_DV}${batchId}-`, tiPfx = `${DOC_TI}${batchId}-`, xfPfx = `${DOC_XF}${batchId}-`;
  const r = Math.round;

  const employment = income.employment.filter(x => !x.id.startsWith(empPfx));
  // Map the AI's aggregate benefits/expenses into the itemised SA102 "other"
  // boxes (15 & 20) so imported figures appear in the box-level editor.
  e.employment.forEach((x, i) => employment.push({ id: `${empPfx}${i}`, employer: x.employer || `Employment ${i + 1}`, pay: r(x.pay), taxDeducted: r(x.taxDeducted), benOther: r(x.benefits), expOther: r(x.expenses) }));

  // Self-employment — turnover path (turnover→15, expenses→30) or a net-profit
  // fallback; capital allowances→box 55, CIS→box 81. calc derives the net.
  const selfEmployment = income.selfEmployment.filter(x => !x.id.startsWith(sePfx));
  e.selfEmployment.forEach((x, i) => {
    const useTurnover = x.turnover > 0;
    selfEmployment.push({
      id: `${sePfx}${i}`, name: x.name || `Self-employment ${i + 1}`,
      turnover: useTurnover ? r(x.turnover) : undefined,
      expOtherCosts: useTurnover ? r(x.expenses) : undefined,
      profit: useTurnover ? 0 : r(x.netProfit),
      enhancedCapitalAllowances: x.capitalAllowances ? r(x.capitalAllowances) : undefined,
      cisDeductions: x.cis ? r(x.cis) : undefined,
    });
  });

  const partnerships = (income.partnerships ?? []).filter(x => !x.id.startsWith(ptPfx));
  e.partnerships.forEach((x, i) => partnerships.push({ id: `${ptPfx}${i}`, name: x.name || `Partnership ${i + 1}`, profit: r(x.profit), incomeTaxTaken: x.taxTaken ? r(x.taxTaken) : undefined, cisDeductions: x.cis ? r(x.cis) : undefined }));

  // UK property — rents (20) + expense buckets (24/25/27/29); finance costs go to
  // box 26 (commercial) or box 44 residential-finance reducer; else net profit.
  const property = income.property.filter(x => !x.id.startsWith(propPfx));
  e.property.forEach((x, i) => {
    const useRents = x.rents > 0;
    property.push({
      id: `${propPfx}${i}`, address: x.address || `Property ${i + 1}`,
      rents: useRents ? r(x.rents) : undefined,
      expPremises: useRents ? r(x.expPremises) : undefined,
      expRepairs: useRents ? r(x.expRepairs) : undefined,
      expProfessional: useRents ? r(x.expProfessional) : undefined,
      expOther: useRents ? r(x.expOther) : undefined,
      expLoanInterest: useRents && !x.residential ? r(x.expFinance) : undefined,
      residentialFinanceCosts: useRents && x.residential ? r(x.expFinance) : undefined,
      profit: useRents ? 0 : r(x.netProfit),
    });
  });

  // Each extracted dividend becomes its own itemised entry (keeps manual + prior-scan ones).
  let dividendItems = income.dividendItems;
  if (e.dividendList.length) {
    const kept = (income.dividendItems ?? []).filter(x => !x.id.startsWith(dvPfx));
    dividendItems = [...kept, ...e.dividendList.map((x, i) => ({ id: `${dvPfx}${i}`, company: x.company || `Dividend ${i + 1}`, description: x.description, amount: r(x.amount) }))];
  }

  // Taxed UK interest (net + tax) → SA100 box 1 itemised entries.
  let taxedInterestItems = income.taxedInterestItems;
  if (e.taxedInterestList.length) {
    const kept = (income.taxedInterestItems ?? []).filter(x => !x.id.startsWith(tiPfx));
    taxedInterestItems = [...kept, ...e.taxedInterestList.map((x, i) => ({ id: `${tiPfx}${i}`, description: x.description, net: r(x.net), tax: r(x.tax) }))];
  }

  // Foreign — each line into its SA106 table (interest / dividends / pensions /
  // other) or a foreign-property, batch-keyed so re-scans are additive.
  let foreign = income.foreign;
  if (e.foreignItems.length) {
    foreign = { ...(income.foreign ?? {}) };
    const strip = (arr?: ForeignRow[]) => (arr ?? []).filter(x => !x.id.startsWith(xfPfx));
    const interest: ForeignRow[] = [], dividends: ForeignRow[] = [], pensions: ForeignRow[] = [], otherAll: ForeignRow[] = [];
    const properties: ForeignProperty[] = [];
    e.foreignItems.forEach((it, i) => {
      const country = it.country || undefined;
      if (it.category === 'property') { properties.push({ id: `${xfPfx}p${i}`, country, totalRents: r(it.income), foreignTax: r(it.foreignTax), creditRelief: true }); return; }
      const row: ForeignRow = { id: `${xfPfx}${it.category}${i}`, country, incomeArising: r(it.income), foreignTax: r(it.foreignTax), creditRelief: true };
      (it.category === 'interest' ? interest : it.category === 'dividends' ? dividends : it.category === 'pension' ? pensions : otherAll).push(row);
    });
    foreign.interest = [...strip(foreign.interest), ...interest];
    foreign.dividends = [...strip(foreign.dividends), ...dividends];
    foreign.pensions = [...strip(foreign.pensions), ...pensions];
    foreign.otherAll = [...strip(foreign.otherAll), ...otherAll];
    foreign.properties = [...(foreign.properties ?? []).filter(x => !x.id.startsWith(xfPfx)), ...properties];
  }

  // Trusts & estates → SA107 boxes (income.sa107), summed by area across the
  // scanned lines. Scalar boxes take the scanned total when the scan found one.
  let sa107 = income.sa107;
  if (e.trustEstate.length) {
    const d = { discretionaryNet: 0, nonDiscNonSavings: 0, nonDiscSavings: 0, nonDiscDividend: 0, estateNonSavings: 0, estateSavings: 0, estateDividend: 0 };
    for (const t of e.trustEstate) {
      if (t.category === 'discretionaryTrust') d.discretionaryNet += t.nonSavings;
      else if (t.category === 'nonDiscTrust') { d.nonDiscNonSavings += t.nonSavings; d.nonDiscSavings += t.savings; d.nonDiscDividend += t.dividend; }
      else { d.estateNonSavings += t.nonSavings; d.estateSavings += t.savings; d.estateDividend += t.dividend; }
    }
    sa107 = { ...(income.sa107 ?? {}) };
    const put = (k: keyof Sa107, v: number) => { if (v > 0) (sa107 as Record<string, number>)[k] = r(v); };
    put('discretionaryNet', d.discretionaryNet);
    put('nonDiscNonSavings', d.nonDiscNonSavings); put('nonDiscSavings', d.nonDiscSavings); put('nonDiscDividend', d.nonDiscDividend);
    put('estateNonSavings', d.estateNonSavings); put('estateSavings', d.estateSavings); put('estateDividend', d.estateDividend);
  }

  // Capital gains → SA108 boxes (income.sa108), summed per asset class.
  let sa108 = income.sa108;
  if (e.capitalGains.length) {
    const acc = new Map<CgtCategory, { disposals: number; proceeds: number; costs: number; gains: number; losses: number }>();
    for (const c of e.capitalGains) {
      const a = acc.get(c.category) ?? { disposals: 0, proceeds: 0, costs: 0, gains: 0, losses: 0 };
      a.disposals += c.disposals; a.proceeds += c.proceeds; a.costs += c.costs; a.gains += c.gains; a.losses += c.losses;
      acc.set(c.category, a);
    }
    sa108 = { ...(income.sa108 ?? {}) };
    const put = (k: keyof Sa108, v: number) => { if (v > 0) (sa108 as Record<string, number>)[k] = r(v); };
    for (const [cat, a] of acc) {
      const box = CGT_BOX[cat];
      put(box.disposals, a.disposals); put(box.proceeds, a.proceeds); put(box.costs, a.costs); put(box.gains, a.gains); put(box.losses, a.losses);
    }
  }

  // SA109 residence facts — additive: fill only boxes the user hasn't set (never
  // flip a hand-entered flag off, or overwrite a typed value with a scan).
  let residence = income.residence;
  if (e.residence) {
    const cur = income.residence ?? {};
    const rs = e.residence;
    const setBool = (c: boolean | undefined, v: boolean) => (v && !c ? true : c);
    const setNum = (c: number | undefined, v: number) => ((c == null || c === 0) && v > 0 ? r(v) : c);
    const setStr = (c: string | undefined, v: string) => (!c && v ? v : c);
    residence = {
      ...cur,
      notResident: setBool(cur.notResident, rs.notResident),
      splitYear: setBool(cur.splitYear, rs.splitYear),
      residentLastYear: setBool(cur.residentLastYear, rs.residentLastYear),
      homeOverseas: setBool(cur.homeOverseas, rs.homeOverseas),
      daysInUk: setNum(cur.daysInUk, rs.daysInUk),
      daysExceptional: setNum(cur.daysExceptional, rs.daysExceptional),
      daysTransit: setNum(cur.daysTransit, rs.daysTransit),
      ukTies: setNum(cur.ukTies, rs.ukTies),
      workdaysUk: setNum(cur.workdaysUk, rs.workdaysUk),
      workdaysOverseas: setNum(cur.workdaysOverseas, rs.workdaysOverseas),
      figArrivalDate: setStr(cur.figArrivalDate, rs.arrivalDate),
      nationalResidentCountries: setStr(cur.nationalResidentCountries, rs.nationalResidentCountries),
      residentCountryCodes: setStr(cur.residentCountryCodes, rs.residentCountryCodes),
      figIncomeClaim: setBool(cur.figIncomeClaim, rs.figIncomeClaim),
      figGainsClaim: setBool(cur.figGainsClaim, rs.figGainsClaim),
      dtaIncomeReliefAmount: setNum(cur.dtaIncomeReliefAmount, rs.dtaIncomeReliefAmount),
      dtaReliefResidence: setNum(cur.dtaReliefResidence, rs.dtaReliefResidence),
      dtaReliefOther: setNum(cur.dtaReliefOther, rs.dtaReliefOther),
    };
    residence.status = residence.notResident ? 'non-resident' : residence.splitYear ? 'split-year' : cur.status;
  }

  // SA101 additional-information figures — fill only boxes the user hasn't set
  // (never overwrite a typed figure with a scan).
  let additional = income.additional;
  if (e.additional) {
    const cur = income.additional ?? {};
    const ad = e.additional;
    const setNum = (c: number | undefined, v: number) => ((c == null || c === 0) && v > 0 ? r(v) : c);
    additional = {
      ...cur,
      giltInterestNet: setNum(cur.giltInterestNet, ad.giltInterestNet),
      giltTaxTaken: setNum(cur.giltTaxTaken, ad.giltTaxTaken),
      giltGross: setNum(cur.giltGross, ad.giltGross),
      chargeableEventGains: setNum(cur.chargeableEventGains, ad.lifeGain),
      chargeableEventUkPolicy: cur.chargeableEventUkPolicy || (ad.lifeGain > 0 && ad.lifeGainUkPolicy) || undefined,
      lifeGainTaxPaidYears: setNum(cur.lifeGainTaxPaidYears, ad.lifeGainYears),
      lifeGainNoTaxPaid: setNum(cur.lifeGainNoTaxPaid, ad.lifeGainNoTaxPaid),
      voidedIsaGain: setNum(cur.voidedIsaGain, ad.voidedIsaGain),
      voidedIsaTax: setNum(cur.voidedIsaTax, ad.voidedIsaTax),
      stockDividends: setNum(cur.stockDividends, ad.stockDividends),
      redundancyReceipts: setNum(cur.redundancyReceipts, ad.redundancy),
      taxableLumpSums: setNum(cur.taxableLumpSums, ad.taxableLumpSums),
      taxOffLumpSums: setNum(cur.taxOffLumpSums, ad.taxOffLumpSums),
      lumpSumExemption30k: setNum(cur.lumpSumExemption30k, ad.lumpSumExemption30k),
      eisSubscriptions: setNum(cur.eisSubscriptions, ad.eisSubscriptions),
      seisSubscriptions: setNum(cur.seisSubscriptions, ad.seisSubscriptions),
      vctSubscriptions: setNum(cur.vctSubscriptions, ad.vctSubscriptions),
      citrInvestment: setNum(cur.citrInvestment, ad.citrInvestment),
      annualAllowanceExcess: setNum(cur.annualAllowanceExcess, ad.annualAllowanceExcess),
      annualAllowanceTaxPaid: setNum(cur.annualAllowanceTaxPaid, ad.annualAllowanceTaxPaid),
      businessReceipts: setNum(cur.businessReceipts, ad.businessReceipts),
    };
  }

  // SA102 NI Assembly office figures — fill only boxes the user hasn't set.
  let niAssembly = income.niAssembly;
  if (e.niAssembly) {
    const cur = income.niAssembly ?? {};
    const na = e.niAssembly;
    const setNum = (c: number | undefined, v: number) => ((c == null || c === 0) && v > 0 ? r(v) : c);
    niAssembly = {
      ...cur,
      p60Pay: setNum(cur.p60Pay, na.p60Pay),
      payrolledBenefitsStudentLoan: setNum(cur.payrolledBenefitsStudentLoan, na.payrolledBenefitsStudentLoan),
      taxTakenOff: setNum(cur.taxTakenOff, na.taxTakenOff),
      officeCostExpenditure: setNum(cur.officeCostExpenditure, na.officeCostExpenditure),
      otherCashReimbursements: setNum(cur.otherCashReimbursements, na.otherCashReimbursements),
      allOtherBenefits: setNum(cur.allOtherBenefits, na.allOtherBenefits),
      balancingCharges: setNum(cur.balancingCharges, na.balancingCharges),
      secretarialAssistance: setNum(cur.secretarialAssistance, na.secretarialAssistance),
      officeExpenses: setNum(cur.officeExpenses, na.officeExpenses),
      otherExpensesCapitalAllowances: setNum(cur.otherExpensesCapitalAllowances, na.otherExpensesCapitalAllowances),
    };
  }

  // SA102 MPs office figures — fill only boxes the user hasn't set.
  let parliament = income.parliament;
  if (e.parliament) {
    const cur = income.parliament ?? {};
    const pa = e.parliament;
    const setNum = (c: number | undefined, v: number) => ((c == null || c === 0) && v > 0 ? r(v) : c);
    parliament = {
      ...cur,
      p60Pay: setNum(cur.p60Pay, pa.p60Pay),
      payrolledBenefitsStudentLoan: setNum(cur.payrolledBenefitsStudentLoan, pa.payrolledBenefitsStudentLoan),
      taxTakenOff: setNum(cur.taxTakenOff, pa.taxTakenOff),
      travelVouchers: setNum(cur.travelVouchers, pa.travelVouchers),
      accommodation: setNum(cur.accommodation, pa.accommodation),
      officeCostsExpenditure: setNum(cur.officeCostsExpenditure, pa.officeCostsExpenditure),
      contingencyPayment: setNum(cur.contingencyPayment, pa.contingencyPayment),
      financialAssistanceFund: setNum(cur.financialAssistanceFund, pa.financialAssistanceFund),
      allOtherBenefits: setNum(cur.allOtherBenefits, pa.allOtherBenefits),
      balancingCharges: setNum(cur.balancingCharges, pa.balancingCharges),
      travelWarrants: setNum(cur.travelWarrants, pa.travelWarrants),
      secretarialAssistance: setNum(cur.secretarialAssistance, pa.secretarialAssistance),
      officeExpenses: setNum(cur.officeExpenses, pa.officeExpenses),
      otherExpensesCapitalAllowances: setNum(cur.otherExpensesCapitalAllowances, pa.otherExpensesCapitalAllowances),
    };
  }

  const setIf = (val: number, current: number) => (val > 0 ? r(val) : current);
  return {
    ...income, employment, selfEmployment, partnerships, property, dividendItems, taxedInterestItems, foreign, sa107, sa108, residence, additional, niAssembly, parliament,
    dividends: setIf(e.dividends, income.dividends),
    savingsInterest: setIf(e.savingsInterest, income.savingsInterest),
    foreignDividendsMain: setIf(e.foreignDividends, income.foreignDividendsMain ?? 0),
    foreignDividendsTax: setIf(e.foreignDividendsTax, income.foreignDividendsTax ?? 0),
    pensionsIncome: setIf(e.pensionsIncome, income.pensionsIncome),
    statePension: setIf(e.statePension, income.statePension ?? 0),
    otherIncome: setIf(e.otherIncome, income.otherIncome),
    giftAid: setIf(e.giftAid, income.giftAid),
    pensionContributions: setIf(e.pensionContributions, income.pensionContributions),
    childBenefit: setIf(e.childBenefit, income.childBenefit ?? 0),
  };
}
