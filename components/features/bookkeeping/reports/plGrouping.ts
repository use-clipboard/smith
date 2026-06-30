/**
 * plGrouping — shared, pure helpers for laying P&L accounts out in the
 * canonical accountant's order (Income → Cost of sales → Expenses → Taxation,
 * then any custom ledgers). Extracted so the Management Accounts forecast can
 * reuse the exact bucketing the standalone Profit & Loss report uses, without
 * duplicating the ordering rules.
 */

export interface PlBalance {
  id: string;
  name: string;
  ledger: string | null;
  account_type: 'asset' | 'liability' | 'equity' | 'income' | 'expense';
  code?: string | null;
  balance: number;
}

export type PlBucket = 'income' | 'cost_of_sales' | 'expense' | 'taxation';

export const PL_PREFERRED_SECTIONS: { ledger: string; title: string; bucket: PlBucket }[] = [
  { ledger: 'Income',        title: 'Income',        bucket: 'income'        },
  { ledger: 'Cost of sales', title: 'Cost of sales', bucket: 'cost_of_sales' },
  { ledger: 'Expenses',      title: 'Expenses',      bucket: 'expense'       },
  { ledger: 'Taxation',      title: 'Taxation',      bucket: 'taxation'      },
];

/** Decide which subtotal a ledger contributes to — ledger-name hints first,
 *  then account_type as a backstop, so unfamiliar/imported ledgers still land
 *  somewhere sensible. Mirrors ProfitLossTab. */
export function bucketForLedger(ledger: string, sampleAccountType: string): PlBucket {
  const lc = ledger.toLowerCase();
  if (lc === 'income' || lc.includes('income') || lc.includes('sales') || lc.includes('revenue')) return 'income';
  if (lc === 'cost of sales' || lc.includes('cost of sales') || lc.includes('cogs')) return 'cost_of_sales';
  if (lc === 'taxation' || lc.includes('tax')) return 'taxation';
  if (sampleAccountType === 'income') return 'income';
  return 'expense';
}

/** Income flips sign so credits read positive; expenses keep their natural
 *  (debit-positive) sign. */
export function plDisplayValue(b: { account_type: string; balance: number }): number {
  return b.account_type === 'income' ? -b.balance : b.balance;
}

/** Money formatter matching the P&L / BS reports: no decimals, parens for
 *  negatives, dash for ~zero. */
export function fmtMoney(n: number): string {
  if (Math.abs(n) < 0.005) return '-';
  const abs = Math.abs(n).toLocaleString('en-GB', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  return n < 0 ? `(${abs})` : abs;
}

/** Ratio → "12.3%". Null / non-finite → dash. */
export function fmtPct(n: number | null): string {
  if (n === null || !isFinite(n)) return '-';
  return `${(n * 100).toFixed(1)}%`;
}

export function daysInclusive(fromIso: string, toIso: string): number {
  return Math.round((new Date(toIso).getTime() - new Date(fromIso).getTime()) / 86_400_000) + 1;
}

export function isoMinusOneYear(iso: string): string {
  const d = new Date(iso);
  d.setFullYear(d.getFullYear() - 1);
  return d.toISOString().slice(0, 10);
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
export function longDate(iso: string | null): string {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return '';
  const [y, m, d] = iso.split('-').map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

/** Fetch P&L account balances (income/expense only) for a date range. Excludes
 *  year-end closing journals (YET) — exactly as the P&L report does — otherwise
 *  every P&L account nets to zero. */
export async function fetchPlBalances(bookId: string, from: string | null, to: string | null): Promise<PlBalance[]> {
  const params = new URLSearchParams();
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  params.set('exclude_types', 'YET');
  const r = await fetch(`/api/bookkeeping/books/${bookId}/balances?${params}`);
  if (!r.ok) throw new Error('Failed to load balances');
  const d = await r.json();
  const accounts = (d.accounts ?? []) as PlBalance[];
  return accounts.filter(a => a.account_type === 'income' || a.account_type === 'expense');
}

/** Order the ledgers that contain P&L accounts: preferred sections first in
 *  canonical order, then any others alphabetically. */
export function orderPlLedgers(accounts: PlBalance[]): { ledger: string; title: string; bucket: PlBucket }[] {
  const ledgerSet = new Set<string>();
  const sampleType = new Map<string, string>();
  for (const a of accounts) {
    const lg = (a.ledger ?? '').trim();
    if (!lg) continue;
    ledgerSet.add(lg);
    if (!sampleType.has(lg)) sampleType.set(lg, a.account_type);
  }
  const preferred = new Set(PL_PREFERRED_SECTIONS.map(s => s.ledger));
  const ordered: { ledger: string; title: string; bucket: PlBucket }[] = [];
  for (const def of PL_PREFERRED_SECTIONS) {
    if (ledgerSet.has(def.ledger)) ordered.push(def);
  }
  for (const lg of [...ledgerSet].filter(l => !preferred.has(l)).sort((a, b) => a.localeCompare(b))) {
    ordered.push({ ledger: lg, title: lg, bucket: bucketForLedger(lg, sampleType.get(lg) ?? 'expense') });
  }
  return ordered;
}
