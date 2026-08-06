// Tax Studio — client-side persistence helpers.
//
// Thin wrappers over /api/tax-studio/returns so the UI never calls fetch()
// directly. Returns are stored server-side (Supabase, jsonb `data` column).

import type { TaxReturn } from './types';

const BASE = '/api/tax-studio/returns';

export interface ReturnDto {
  id: string;
  data: TaxReturn;
  updatedAt: string;
  mine: boolean;
  clientLinked?: boolean;
}

export interface ReturnListItem {
  id: string;
  ret: TaxReturn;
  /** dd-mm-yyyy HH:mm */
  date: string;
  mine: boolean;
  /** False when the client record has been deleted (return is orphaned). */
  clientLinked: boolean;
}

function fmt(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}-${p(d.getMonth() + 1)}-${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function toItem(dto: ReturnDto): ReturnListItem {
  return { id: dto.id, ret: { ...dto.data, id: dto.id }, date: fmt(dto.updatedAt), mine: dto.mine, clientLinked: dto.clientLinked !== false };
}

async function readJson<T>(r: Response, fallback: string): Promise<T> {
  const ct = r.headers.get('content-type') ?? '';
  if (!ct.includes('application/json')) {
    if (r.status === 401 || r.status === 403 || !r.ok) {
      throw new Error('Your session has expired — please refresh the page and sign in again.');
    }
    throw new Error(fallback);
  }
  const d = await r.json().catch(() => ({} as Record<string, unknown>));
  if (!r.ok) throw new Error((d as { error?: string }).error ?? fallback);
  return d as T;
}

export async function listReturns(): Promise<ReturnListItem[]> {
  const r = await fetch(BASE, { cache: 'no-store' });
  const d = await readJson<{ returns: ReturnDto[] }>(r, 'Could not load returns.');
  return (d.returns ?? []).map(toItem);
}

export async function createReturn(ret: TaxReturn): Promise<TaxReturn> {
  const r = await fetch(BASE, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data: ret }),
  });
  const d = await readJson<{ return: ReturnDto }>(r, 'Could not create the return.');
  return { ...d.return.data, id: d.return.id };
}

export async function saveReturn(ret: TaxReturn): Promise<void> {
  const r = await fetch(`${BASE}/${ret.id}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data: ret }),
  });
  await readJson(r, 'Save failed.');
}

export async function deleteReturn(id: string): Promise<void> {
  const r = await fetch(`${BASE}/${id}`, { method: 'DELETE' });
  await readJson(r, 'Delete failed.');
}

// ── HMRC ITSA final declaration ──────────────────────────────────────────────
import type { ClientFraudData } from '@/lib/hmrc/fraudHeaders';

export interface HmrcCalcSummary {
  calculationId: string | null;
  totalIncomeTaxAndNicsDue: number | null;
  incomeTaxDue: number | null;
  class4NicDue: number | null;
  totalTaxable: number | null;
}
export interface HmrcCalcResponse {
  ok: boolean;
  calculationId: string;
  isTest: boolean;
  hmrcStatus?: number;
  retrieved: boolean;
  summary?: HmrcCalcSummary;
}

/** Trigger + retrieve an HMRC final-declaration calculation for the return. */
export async function hmrcCalculate(returnId: string, fraudData: ClientFraudData, testScenario?: string): Promise<HmrcCalcResponse> {
  const r = await fetch(`${BASE}/${returnId}/hmrc-calculate`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fraudData, testScenario }),
  });
  return readJson<HmrcCalcResponse>(r, 'HMRC calculation failed.');
}

/** Submit the HMRC final declaration (crystallise) for a reviewed calculation. */
export async function hmrcSubmitFinal(returnId: string, calculationId: string, fraudData: ClientFraudData, testScenario?: string): Promise<{ ok: boolean; submissionRef: string; isTest: boolean; submittedAt: string }> {
  const r = await fetch(`${BASE}/${returnId}/hmrc-submit`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ calculationId, fraudData, testScenario }),
  });
  return readJson(r, 'HMRC final declaration failed.');
}
