// Tax Studio — client-side document extraction (SA100).

import { fileToBase64, readFileAsText, compressImage } from '@/utils/fileUtils';
import type { Sa100Income } from './types';

export interface Sa100Extraction {
  documents: { fileName: string; docType: string; summary: string }[];
  employment: { employer: string; pay: number; taxDeducted: number; benefits: number }[];
  selfEmployment: { name: string; profit: number }[];
  property: { address: string; profit: number }[];
  dividends: number;
  savingsInterest: number;
  pensionsIncome: number;
  otherIncome: number;
  giftAid: number;
  pensionContributions: number;
  childBenefit: number;
  notes: string[];
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
    employment: arr<Sa100Extraction['employment'][number]>(e.employment).map(x => ({ employer: String(x?.employer ?? ''), pay: num(x?.pay), taxDeducted: num(x?.taxDeducted), benefits: num(x?.benefits) })),
    selfEmployment: arr<Sa100Extraction['selfEmployment'][number]>(e.selfEmployment).map(x => ({ name: String(x?.name ?? ''), profit: num(x?.profit) })),
    property: arr<Sa100Extraction['property'][number]>(e.property).map(x => ({ address: String(x?.address ?? ''), profit: num(x?.profit) })),
    dividends: num(e.dividends), savingsInterest: num(e.savingsInterest), pensionsIncome: num(e.pensionsIncome),
    otherIncome: num(e.otherIncome), giftAid: num(e.giftAid), pensionContributions: num(e.pensionContributions),
    childBenefit: num(e.childBenefit), notes: arr<string>(e.notes),
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
  return e.employment.length > 0 || e.selfEmployment.length > 0 || e.property.length > 0
    || [e.dividends, e.savingsInterest, e.pensionsIncome, e.otherIncome, e.giftAid, e.pensionContributions, e.childBenefit].some(n => n > 0);
}

const DOC_EMP = 'doc-emp-', DOC_SE = 'doc-se-', DOC_PROP = 'doc-prop-';

/** Merge extracted figures into the income. Document-sourced rows carry a prefix
 *  so re-importing replaces them; scalar fields are set only when the documents
 *  found a value (never wiping a manual figure with a zero). */
export function mergeExtractionIntoIncome(income: Sa100Income, e: Sa100Extraction): Sa100Income {
  const employment = income.employment.filter(x => !x.id.startsWith(DOC_EMP));
  e.employment.forEach((x, i) => employment.push({ id: `${DOC_EMP}${i}`, employer: x.employer || `Employment ${i + 1}`, pay: Math.round(x.pay), taxDeducted: Math.round(x.taxDeducted), benefits: Math.round(x.benefits) }));

  const selfEmployment = income.selfEmployment.filter(x => !x.id.startsWith(DOC_SE));
  e.selfEmployment.forEach((x, i) => selfEmployment.push({ id: `${DOC_SE}${i}`, name: x.name || `Self-employment ${i + 1}`, profit: Math.round(x.profit) }));

  const property = income.property.filter(x => !x.id.startsWith(DOC_PROP));
  e.property.forEach((x, i) => property.push({ id: `${DOC_PROP}${i}`, address: x.address || `Property ${i + 1}`, profit: Math.round(x.profit) }));

  const setIf = (val: number, current: number) => (val > 0 ? Math.round(val) : current);
  return {
    ...income, employment, selfEmployment, property,
    dividends: setIf(e.dividends, income.dividends),
    savingsInterest: setIf(e.savingsInterest, income.savingsInterest),
    pensionsIncome: setIf(e.pensionsIncome, income.pensionsIncome),
    otherIncome: setIf(e.otherIncome, income.otherIncome),
    giftAid: setIf(e.giftAid, income.giftAid),
    pensionContributions: setIf(e.pensionContributions, income.pensionContributions),
    childBenefit: setIf(e.childBenefit, income.childBenefit ?? 0),
  };
}
