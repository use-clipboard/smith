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

export async function listEngagements(): Promise<AccountsHistoryItem[]> {
  const r = await fetch(BASE, { cache: 'no-store' });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? 'Could not load accounts.');
  const d = await r.json() as { engagements: EngagementDto[] };
  return (d.engagements ?? []).map(toHistoryItem);
}

/** Create a new engagement; returns the stored engagement (server stamps id + preparedBy). */
export async function createEngagement(e: Engagement): Promise<Engagement> {
  const r = await fetch(BASE, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data: e }),
  });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? 'Could not create the engagement.');
  const d = await r.json() as { engagement: EngagementDto };
  return { ...d.engagement.data, id: d.engagement.id };
}

/** Persist the current engagement snapshot (autosave). */
export async function saveEngagement(e: Engagement): Promise<void> {
  const r = await fetch(`${BASE}/${e.id}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data: e }),
  });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? 'Save failed.');
}

export async function deleteEngagement(id: string): Promise<void> {
  const r = await fetch(`${BASE}/${id}`, { method: 'DELETE' });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? 'Delete failed.');
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
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? 'Publish failed.');
  return (await r.json()).outputId as string;
}
