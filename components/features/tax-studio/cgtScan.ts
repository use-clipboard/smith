// Tax Studio — client-side helpers for the CGT calculator's document scanner.
// One scan can produce many disposals; scans accumulate into the calculator.

import type { CgtCalcDisposal } from './types';
export { encodeFile } from './extract';
export type { EncodedFile } from './extract';
import type { EncodedFile } from './extract';

type AssetClass = CgtCalcDisposal['assetClass'];
const ASSET_CLASSES = new Set<AssetClass>(['residential', 'listed', 'unlisted', 'crypto', 'other']);
const coerceClass = (v: unknown): AssetClass => (ASSET_CLASSES.has(v as AssetClass) ? v as AssetClass : 'other');

export interface CgtExtraction {
  documents: { fileName: string; docType: string; summary: string }[];
  disposals: {
    description: string; assetClass: AssetClass; proceeds: number; acquisitionCost: number;
    incidentalCosts: number; improvementCosts: number; acquisitionDate?: string; disposalDate?: string; wasMainResidence: boolean;
  }[];
  setAside: { label: string; reason: string }[];
  needs: string[];
}

function normalise(raw: unknown): CgtExtraction {
  const e = (raw ?? {}) as Partial<CgtExtraction>;
  const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? v as T[] : []);
  const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  const str = (v: unknown): string | undefined => (v != null && v !== '' ? String(v) : undefined);
  return {
    documents: arr(e.documents),
    disposals: arr<CgtExtraction['disposals'][number]>(e.disposals).map(d => ({
      description: String(d?.description ?? ''), assetClass: coerceClass(d?.assetClass),
      proceeds: num(d?.proceeds), acquisitionCost: num(d?.acquisitionCost), incidentalCosts: num(d?.incidentalCosts),
      improvementCosts: num(d?.improvementCosts), acquisitionDate: str(d?.acquisitionDate), disposalDate: str(d?.disposalDate),
      wasMainResidence: d?.wasMainResidence === true,
    })).filter(d => d.proceeds > 0 || d.acquisitionCost > 0 || d.description),
    setAside: arr<CgtExtraction['setAside'][number]>(e.setAside).map(s => ({ label: String(s?.label ?? ''), reason: String(s?.reason ?? '') })).filter(s => s.label || s.reason),
    needs: arr<string>(e.needs).map(String).filter(Boolean),
  };
}

export async function fetchCgtExtraction(taxYear: string, files: EncodedFile[]): Promise<CgtExtraction> {
  const r = await fetch('/api/tax-studio/cgt-extract', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ taxYear, files }),
  });
  const ct = r.headers.get('content-type') ?? '';
  const d = ct.includes('application/json') ? await r.json().catch(() => ({})) : {};
  if (!r.ok) throw new Error((d as { error?: string }).error ?? 'Could not read the documents.');
  return normalise((d as { extraction?: unknown }).extraction);
}

// ── Editable disposal proposals (the left panel of the scan lightbox) ──────────
export interface CgtScanProposal {
  id: string;
  include: boolean;
  description: string;
  assetClass: AssetClass;
  proceeds: number;
  acquisitionCost: number;
  incidentalCosts: number;
  improvementCosts: number;
  acquisitionDate?: string;
  disposalDate?: string;
  wasMainResidence?: boolean;
  occupationMonths?: number;
  ownershipMonths?: number;
  wasLet?: boolean;
  claimBadr?: boolean;
}

let _pid = 0;
const pid = () => `cs-${Date.now()}-${_pid++}`;

export function proposalsFromExtraction(e: CgtExtraction): CgtScanProposal[] {
  return e.disposals.map(d => ({
    id: pid(), include: true, description: d.description, assetClass: d.assetClass, proceeds: Math.round(d.proceeds),
    acquisitionCost: Math.round(d.acquisitionCost), incidentalCosts: Math.round(d.incidentalCosts), improvementCosts: Math.round(d.improvementCosts),
    acquisitionDate: d.acquisitionDate, disposalDate: d.disposalDate, wasMainResidence: d.wasMainResidence,
  }));
}

/** Turn an (included) proposal into a calculator disposal. */
export function proposalToDisposal(p: CgtScanProposal): CgtCalcDisposal {
  return {
    id: pid(), description: p.description || 'Disposal', assetClass: p.assetClass, proceeds: Math.round(p.proceeds || 0),
    acquisitionCost: Math.round(p.acquisitionCost || 0), incidentalCosts: Math.round(p.incidentalCosts || 0), improvementCosts: Math.round(p.improvementCosts || 0),
    acquisitionDate: p.acquisitionDate, disposalDate: p.disposalDate,
    wasMainResidence: p.wasMainResidence, occupationMonths: p.occupationMonths, ownershipMonths: p.ownershipMonths, wasLet: p.wasLet, claimBadr: p.claimBadr,
  };
}

// ── Ask-SMITH relief chat — edits patch the disposals ─────────────────────────
export interface CgtScanPatch {
  description?: string; assetClass?: AssetClass; proceeds?: number; acquisitionCost?: number; incidentalCosts?: number;
  improvementCosts?: number; wasMainResidence?: boolean; occupationMonths?: number; ownershipMonths?: number; wasLet?: boolean; claimBadr?: boolean;
}
export interface CgtScanEdit { action: 'add' | 'edit'; target?: string; reason?: string; patch?: CgtScanPatch }

const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const bool = (v: unknown): boolean | undefined => (typeof v === 'boolean' ? v : undefined);
/** Keep only the recognised patch keys, coerced to their types. */
function cleanPatch(patch?: CgtScanPatch): Partial<CgtScanProposal> {
  if (!patch) return {};
  const out: Partial<CgtScanProposal> = {};
  if (patch.description != null) out.description = String(patch.description);
  if (patch.assetClass != null) out.assetClass = coerceClass(patch.assetClass);
  for (const k of ['proceeds', 'acquisitionCost', 'incidentalCosts', 'improvementCosts', 'occupationMonths', 'ownershipMonths'] as const) {
    const v = num(patch[k]); if (v != null) out[k] = Math.round(v);
  }
  for (const k of ['wasMainResidence', 'wasLet', 'claimBadr'] as const) {
    const v = bool(patch[k]); if (v != null) out[k] = v;
  }
  return out;
}

export function applyCgtScanEdit(proposals: CgtScanProposal[], edit: CgtScanEdit): CgtScanProposal[] {
  const patch = cleanPatch(edit.patch);
  if (edit.action === 'add') {
    return [...proposals, {
      id: pid(), include: true, description: patch.description || 'Added by SMITH', assetClass: patch.assetClass ?? 'other',
      proceeds: patch.proceeds ?? 0, acquisitionCost: patch.acquisitionCost ?? 0, incidentalCosts: patch.incidentalCosts ?? 0, improvementCosts: patch.improvementCosts ?? 0,
      wasMainResidence: patch.wasMainResidence, occupationMonths: patch.occupationMonths, ownershipMonths: patch.ownershipMonths, wasLet: patch.wasLet, claimBadr: patch.claimBadr,
    }];
  }
  return proposals.map(p => p.description === edit.target ? { ...p, ...patch } : p);
}

export async function fetchCgtScanChat(payload: {
  taxYear: string;
  documents: { docType: string; summary: string }[];
  disposals: { description: string; assetClass: string; proceeds: number; gain: number }[];
  needs: string[];
  messages: { role: 'user' | 'assistant'; content: string }[];
}): Promise<{ reply: string; edits: CgtScanEdit[] }> {
  const r = await fetch('/api/tax-studio/cgt-scan-chat', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
  });
  const ct = r.headers.get('content-type') ?? '';
  const d = ct.includes('application/json') ? await r.json().catch(() => ({})) : {};
  if (!r.ok) throw new Error((d as { error?: string }).error ?? 'SMITH is unavailable right now.');
  const edits = Array.isArray((d as { edits?: unknown }).edits) ? ((d as { edits: CgtScanEdit[] }).edits) : [];
  return { reply: String((d as { reply?: string }).reply ?? ''), edits };
}

/** Whole-asset gross gain for a proposal (for the chat context + display). */
export function proposalGain(p: CgtScanProposal): number {
  return Math.round((p.proceeds || 0) - ((p.acquisitionCost || 0) + (p.incidentalCosts || 0) + (p.improvementCosts || 0)));
}
