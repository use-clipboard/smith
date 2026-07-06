// Accounts Studio — client-side persistence helpers.
//
// Thin wrappers over /api/accounts-studio/engagements so the UI never talks to
// fetch() directly. Engagements are stored server-side (Supabase) — no more
// in-memory demo data.

import type { Engagement } from './types';
import type { AccountsHistoryItem } from './data';

const BASE = '/api/accounts-studio/engagements';

interface EngagementDto {
  id: string;
  data: Engagement;
  updatedAt: string;
  mine: boolean;
}

/** ISO timestamp → 'dd-mm-yyyy HH:mm' (UK display used across the history list). */
function fmt(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}-${p(d.getMonth() + 1)}-${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function toHistoryItem(dto: EngagementDto): AccountsHistoryItem {
  return { id: dto.id, engagement: { ...dto.data, id: dto.id }, date: fmt(dto.updatedAt), mine: dto.mine };
}

/**
 * Parse a JSON response, but fail with a friendly message when the server sends
 * back HTML instead — which happens when the auth middleware redirects an
 * expired session to the login page (a 200 HTML body). Without this, callers hit
 * the raw `Unexpected token '<'` JSON.parse error.
 */
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

export async function listEngagements(): Promise<AccountsHistoryItem[]> {
  const r = await fetch(BASE, { cache: 'no-store' });
  const d = await readJson<{ engagements: EngagementDto[] }>(r, 'Could not load accounts.');
  return (d.engagements ?? []).map(toHistoryItem);
}

/** Create a new engagement; returns the stored engagement (server stamps id + preparedBy). */
export async function createEngagement(e: Engagement): Promise<Engagement> {
  const r = await fetch(BASE, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data: e }),
  });
  const d = await readJson<{ engagement: EngagementDto }>(r, 'Could not create the engagement.');
  return { ...d.engagement.data, id: d.engagement.id };
}

/** Persist the current engagement snapshot (autosave). */
export async function saveEngagement(e: Engagement): Promise<void> {
  const r = await fetch(`${BASE}/${e.id}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data: e }),
  });
  await readJson(r, 'Save failed.');
}

export async function deleteEngagement(id: string): Promise<void> {
  const r = await fetch(`${BASE}/${id}`, { method: 'DELETE' });
  await readJson(r, 'Delete failed.');
}

/** Record the published statutory accounts against the client record. Returns the outputs.id. */
export async function publishEngagement(e: Engagement): Promise<string> {
  const s = e.statements;
  const r = await fetch(`${BASE}/${e.id}/publish`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      clientId: e.clientId,
      clientName: e.companyName,
      clientCode: e.clientRef,
      companyName: e.companyName,
      entityType: e.entityType,
      framework: e.framework,
      periodStart: e.periodStart,
      periodEnd: e.periodEnd,
      turnover: s?.profitLoss.turnoverTotal ?? null,
      netProfit: s?.profitLoss.netProfit ?? null,
      totalAssets: s?.balanceSheet.totalAssets ?? null,
      netAssets: s?.balanceSheet.netAssets ?? null,
      outputId: e.publishedOutputId ?? null,
    }),
  });
  const d = await readJson<{ outputId: string }>(r, 'Publish failed.');
  return d.outputId;
}
