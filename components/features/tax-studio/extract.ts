// Tax Studio — client-side document extraction (SA100).

import { fileToBase64, readFileAsText, compressImage } from '@/utils/fileUtils';
import type { Sa100Income } from './types';

export interface Sa100Extraction {
  documents: { fileName: string; docType: string; summary: string }[];
  employment: { employer: string; pay: number; taxDeducted: number; benefits: number; expenses: number }[];
  selfEmployment: { name: string; profit: number }[];
  partnerships: { name: string; profit: number }[];
  property: { address: string; profit: number }[];
  dividends: number;
  /** Each dividend listed separately (one per voucher/company). */
  dividendList: { company: string; description?: string; amount: number }[];
  savingsInterest: number;
  pensionsIncome: number;
  statePension: number;
  foreignIncome: number;
  foreignTaxPaid: number;
  otherIncome: number;
  giftAid: number;
  pensionContributions: number;
  childBenefit: number;
  notes: string[];
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
  const e = (raw ?? {}) as Partial<Sa100Extraction>;
  const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? v as T[] : []);
  const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  return {
    documents: arr(e.documents),
    employment: arr<Sa100Extraction['employment'][number]>(e.employment).map(x => ({ employer: String(x?.employer ?? ''), pay: num(x?.pay), taxDeducted: num(x?.taxDeducted), benefits: num(x?.benefits), expenses: num(x?.expenses) })),
    selfEmployment: arr<Sa100Extraction['selfEmployment'][number]>(e.selfEmployment).map(x => ({ name: String(x?.name ?? ''), profit: num(x?.profit) })),
    partnerships: arr<Sa100Extraction['partnerships'][number]>(e.partnerships).map(x => ({ name: String(x?.name ?? ''), profit: num(x?.profit) })),
    property: arr<Sa100Extraction['property'][number]>(e.property).map(x => ({ address: String(x?.address ?? ''), profit: num(x?.profit) })),
    dividendList: arr<Sa100Extraction['dividendList'][number]>(e.dividendList).map(x => ({ company: String(x?.company ?? ''), description: x?.description != null ? String(x.description) : undefined, amount: num(x?.amount) })).filter(x => x.amount > 0),
    dividends: num(e.dividends), savingsInterest: num(e.savingsInterest), pensionsIncome: num(e.pensionsIncome),
    statePension: num(e.statePension), foreignIncome: num(e.foreignIncome), foreignTaxPaid: num(e.foreignTaxPaid),
    otherIncome: num(e.otherIncome), giftAid: num(e.giftAid), pensionContributions: num(e.pensionContributions),
    childBenefit: num(e.childBenefit), notes: arr<string>(e.notes),
    setAside: arr<Sa100Extraction['setAside'][number]>(e.setAside).map(x => ({ label: String(x?.label ?? ''), reason: String(x?.reason ?? '') })).filter(x => x.label || x.reason),
    needs: arr<string>(e.needs).map(String).filter(Boolean),
  };
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
    || [e.dividends, e.savingsInterest, e.pensionsIncome, e.statePension, e.foreignIncome, e.otherIncome, e.giftAid, e.pensionContributions, e.childBenefit].some(n => n > 0);
}

// ── Scan-review proposals (the editable left panel of the review lightbox) ─────
export type ScanDest =
  | 'employment' | 'selfEmployment' | 'partnership' | 'property' | 'dividends'
  | 'savingsInterest' | 'pensionsIncome' | 'statePension' | 'foreign' | 'giftAid'
  | 'pensionContributions' | 'otherIncome' | 'childBenefit' | 'exclude';

/** The destinations a scanned figure can be sent to (the reassignment dropdown). */
export const SCAN_DESTS: { value: ScanDest; label: string }[] = [
  { value: 'employment', label: 'Employment (SA102)' },
  { value: 'selfEmployment', label: 'Self-employment (SA103)' },
  { value: 'partnership', label: 'Partnership (SA104)' },
  { value: 'property', label: 'UK property (SA105)' },
  { value: 'foreign', label: 'Foreign income (SA106)' },
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

/** Which SA102 box an employment sub-figure feeds (pay + its companions). */
export type EmpField = 'pay' | 'taxDeducted' | 'benefits' | 'expenses';
export const EMP_FIELD_LABEL: Record<Exclude<EmpField, 'pay'>, string> = {
  taxDeducted: 'PAYE tax deducted', benefits: 'Benefits in kind', expenses: 'Employment expenses',
};

/** One editable proposed entry on the review lightbox's left panel. */
export interface ScanProposal {
  id: string;
  label: string;
  amount: number;
  dest: ScanDest;
  origin: ScanDest;   // where it was first proposed (drives the "reassigned" cue)
  emp?: Sa100Extraction['employment'][number]; // rich P60/P11D data preserved for employment
  group?: string;     // links an employment's figures (pay + tax + benefits + expenses) into one SA102
  empField?: EmpField; // which SA102 box this figure feeds (employment groups only)
}

let _pid = 0;
const pid = () => `sp-${Date.now()}-${_pid++}`;

/** Turn a raw extraction into editable proposals (each figure → its destination). */
export function buildScanProposals(e: Sa100Extraction): ScanProposal[] {
  const out: ScanProposal[] = [];
  const push = (label: string, amount: number, dest: ScanDest, emp?: Sa100Extraction['employment'][number]) => {
    if (amount || emp) out.push({ id: pid(), label, amount: Math.round(amount), dest, origin: dest, emp });
  };
  // Employment — one group per P60, listing EVERY figure read (pay + PAYE tax +
  // benefits + expenses) as its own row so nothing found is hidden.
  e.employment.forEach(x => {
    const who = x.employer || 'employment';
    const group = pid();
    out.push({ id: pid(), label: `Pay — ${who}`, amount: Math.round(x.pay), dest: 'employment', origin: 'employment', emp: x, group, empField: 'pay' });
    const sub = (field: Exclude<EmpField, 'pay'>, amount: number) => {
      if (amount) out.push({ id: pid(), label: `${EMP_FIELD_LABEL[field]} — ${who}`, amount: Math.round(amount), dest: 'employment', origin: 'employment', group, empField: field });
    };
    sub('taxDeducted', x.taxDeducted);
    sub('benefits', x.benefits);
    sub('expenses', x.expenses);
  });
  e.selfEmployment.forEach(x => push(`Trade profit — ${x.name || 'self-employment'}`, x.profit, 'selfEmployment'));
  e.partnerships.forEach(x => push(`Partnership share — ${x.name || 'partnership'}`, x.profit, 'partnership'));
  e.property.forEach(x => push(`Rental profit — ${x.address || 'property'}`, x.profit, 'property'));
  if (e.dividendList.length) e.dividendList.forEach(x => push(`Dividend — ${x.company || 'company'}`, x.amount, 'dividends'));
  else if (e.dividends) push('Dividends', e.dividends, 'dividends');
  if (e.savingsInterest) push('Savings interest', e.savingsInterest, 'savingsInterest');
  if (e.pensionsIncome) push('Pension income', e.pensionsIncome, 'pensionsIncome');
  if (e.statePension) push('State pension', e.statePension, 'statePension');
  if (e.foreignIncome) push('Foreign income', e.foreignIncome, 'foreign');
  if (e.otherIncome) push('Other income', e.otherIncome, 'otherIncome');
  if (e.giftAid) push('Gift Aid', e.giftAid, 'giftAid');
  if (e.pensionContributions) push('Pension contributions', e.pensionContributions, 'pensionContributions');
  if (e.childBenefit) push('Child benefit', e.childBenefit, 'childBenefit');
  return out;
}

function emptyExtraction(): Sa100Extraction {
  return { documents: [], employment: [], selfEmployment: [], partnerships: [], property: [], dividends: 0, dividendList: [], savingsInterest: 0, pensionsIncome: 0, statePension: 0, foreignIncome: 0, foreignTaxPaid: 0, otherIncome: 0, giftAid: 0, pensionContributions: 0, childBenefit: 0, notes: [], setAside: [], needs: [] };
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

  // Employment — reassemble each grouped P60 from its (included) figure rows so
  // pay, PAYE tax, benefits and expenses land in the right SA102 boxes together.
  const groups = new Map<string, ScanProposal[]>();
  for (const p of proposals) {
    if (p.dest === 'employment' && p.group) {
      const g = groups.get(p.group); if (g) g.push(p); else groups.set(p.group, [p]);
    }
  }
  for (const rows of groups.values()) {
    const payRow = rows.find(r => r.empField === 'pay');
    const employer = payRow?.emp?.employer || payRow?.label.replace(/^Pay — /, '') || 'Employment';
    const field = (f: EmpField) => { const r = rows.find(x => x.empField === f); return r ? Math.round(r.amount || 0) : 0; };
    e.employment.push({ employer, pay: field('pay'), taxDeducted: field('taxDeducted'), benefits: field('benefits'), expenses: field('expenses') });
  }

  for (const p of proposals) {
    if (p.dest === 'exclude') continue;
    if (p.dest === 'employment' && p.group) continue; // handled by the group pass above
    const amt = Math.round(p.amount || 0);
    switch (p.dest) {
      case 'employment': e.employment.push({ employer: p.label, pay: amt, taxDeducted: 0, benefits: 0, expenses: 0 }); break;
      case 'selfEmployment': e.selfEmployment.push({ name: p.label, profit: amt }); break;
      case 'partnership': e.partnerships.push({ name: p.label, profit: amt }); break;
      case 'property': e.property.push({ address: p.label, profit: amt }); break;
      case 'dividends': e.dividendList.push({ company: p.label, amount: amt }); e.dividends += amt; break;
      case 'savingsInterest': e.savingsInterest += amt; break;
      case 'pensionsIncome': e.pensionsIncome += amt; break;
      case 'statePension': e.statePension += amt; break;
      case 'foreign': e.foreignIncome += amt; break;
      case 'giftAid': e.giftAid += amt; break;
      case 'pensionContributions': e.pensionContributions += amt; break;
      case 'otherIncome': e.otherIncome += amt; break;
      case 'childBenefit': e.childBenefit += amt; break;
    }
  }
  return mergeExtractionIntoIncome(income, e, batchId);
}

const DOC_EMP = 'doc-emp-', DOC_SE = 'doc-se-', DOC_PT = 'doc-pt-', DOC_PROP = 'doc-prop-', DOC_DV = 'doc-dv-';

/** Merge extracted figures into the income. Each scan is its own BATCH, keyed by
 *  `batchId`: re-importing the same scan replaces only that batch's rows (so a
 *  double-click can't duplicate), while a separate scan ADDS its rows without
 *  touching earlier scans or hand-typed rows — so scanning a forgotten P60 later
 *  is additive, never destructive. Scalar fields are set only when the documents
 *  found a value (never wiping a manual figure with a zero). */
export function mergeExtractionIntoIncome(income: Sa100Income, e: Sa100Extraction, batchId: string): Sa100Income {
  const empPfx = `${DOC_EMP}${batchId}-`, sePfx = `${DOC_SE}${batchId}-`, ptPfx = `${DOC_PT}${batchId}-`, propPfx = `${DOC_PROP}${batchId}-`, dvPfx = `${DOC_DV}${batchId}-`;

  const employment = income.employment.filter(x => !x.id.startsWith(empPfx));
  // Map the AI's aggregate benefits/expenses into the itemised SA102 "other"
  // boxes (15 & 20) so imported figures appear in the box-level editor.
  e.employment.forEach((x, i) => employment.push({ id: `${empPfx}${i}`, employer: x.employer || `Employment ${i + 1}`, pay: Math.round(x.pay), taxDeducted: Math.round(x.taxDeducted), benOther: Math.round(x.benefits), expOther: Math.round(x.expenses) }));

  const selfEmployment = income.selfEmployment.filter(x => !x.id.startsWith(sePfx));
  e.selfEmployment.forEach((x, i) => selfEmployment.push({ id: `${sePfx}${i}`, name: x.name || `Self-employment ${i + 1}`, profit: Math.round(x.profit) }));

  const partnerships = (income.partnerships ?? []).filter(x => !x.id.startsWith(ptPfx));
  e.partnerships.forEach((x, i) => partnerships.push({ id: `${ptPfx}${i}`, name: x.name || `Partnership ${i + 1}`, profit: Math.round(x.profit) }));

  const property = income.property.filter(x => !x.id.startsWith(propPfx));
  e.property.forEach((x, i) => property.push({ id: `${propPfx}${i}`, address: x.address || `Property ${i + 1}`, profit: Math.round(x.profit) }));

  // Each extracted dividend becomes its own itemised entry (keeps manual + prior-scan ones).
  let dividendItems = income.dividendItems;
  if (e.dividendList.length) {
    const kept = (income.dividendItems ?? []).filter(x => !x.id.startsWith(dvPfx));
    dividendItems = [...kept, ...e.dividendList.map((x, i) => ({ id: `${dvPfx}${i}`, company: x.company || `Dividend ${i + 1}`, description: x.description, amount: Math.round(x.amount) }))];
  }

  const setIf = (val: number, current: number) => (val > 0 ? Math.round(val) : current);
  const foreignHas = e.foreignIncome > 0 || e.foreignTaxPaid > 0;
  return {
    ...income, employment, selfEmployment, partnerships, property, dividendItems,
    dividends: setIf(e.dividends, income.dividends),
    savingsInterest: setIf(e.savingsInterest, income.savingsInterest),
    pensionsIncome: setIf(e.pensionsIncome, income.pensionsIncome),
    statePension: setIf(e.statePension, income.statePension ?? 0),
    foreign: foreignHas ? { income: setIf(e.foreignIncome, income.foreign?.income ?? 0), foreignTaxPaid: setIf(e.foreignTaxPaid, income.foreign?.foreignTaxPaid ?? 0) } : income.foreign,
    otherIncome: setIf(e.otherIncome, income.otherIncome),
    giftAid: setIf(e.giftAid, income.giftAid),
    pensionContributions: setIf(e.pensionContributions, income.pensionContributions),
    childBenefit: setIf(e.childBenefit, income.childBenefit ?? 0),
  };
}
