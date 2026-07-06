// Accounts Studio — saved trial balance library (client-side helpers).
//
// Wraps /api/accounts-studio/trial-balances so imports can snapshot their TB and
// the manual/paste flows can load a saved TB, edit it, and pull the prior year.

import type { BalanceAccountType } from '@/lib/bookkeeping/balances';

export interface SavedTbRow {
  name: string;
  type: BalanceAccountType;
  ledger: string | null;
  debit: number;
  credit: number;
}
export interface SavedTbMeta {
  id: string;
  periodEnd: string;   // yyyy-mm-dd
  source: string | null;
  rowCount: number;
  updatedAt: string;
}
export interface SavedTb {
  periodEnd: string;
  source: string | null;
  rows: SavedTbRow[];
}

const BASE = '/api/accounts-studio/trial-balances';

/** yyyy-mm-dd one calendar year earlier (for prior-year lookup). */
export function priorPeriodEnd(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${Number(y) - 1}-${m}-${d}`;
}

export async function listSavedTbs(clientId: string): Promise<SavedTbMeta[]> {
  try {
    const r = await fetch(`${BASE}?clientId=${clientId}`, { cache: 'no-store' });
    if (!r.ok) return [];
    const d = await r.json();
    return (d.trialBalances ?? []) as SavedTbMeta[];
  } catch { return []; }
}

export async function getSavedTb(clientId: string, periodEnd: string): Promise<SavedTb | null> {
  try {
    const r = await fetch(`${BASE}?clientId=${clientId}&periodEnd=${periodEnd}`, { cache: 'no-store' });
    if (!r.ok) return null;
    const d = await r.json();
    return (d.trialBalance ?? null) as SavedTb | null;
  } catch { return null; }
}

/** Snapshot a TB into the library (upsert per client + year-end). Fire-and-forget safe. */
export async function saveTb(
  clientId: string | null,
  periodEnd: string,
  source: string,
  rows: SavedTbRow[],
): Promise<void> {
  if (!clientId || !/^\d{4}-\d{2}-\d{2}$/.test(periodEnd) || rows.length === 0) return;
  try {
    await fetch(BASE, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId, periodEnd, source, rows }),
    });
  } catch { /* non-fatal — the engagement still holds the TB */ }
}
