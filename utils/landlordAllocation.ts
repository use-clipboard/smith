import type { LandlordProperty } from '@/types';

// ─── Address matching ───────────────────────────────────────────────────────
// Deterministic fuzzy matching used to allocate a transaction's free-text
// PropertyAddress to a registered property. Mirrors the abbreviation/partial
// rules the AI address-grouping prompt uses, but runs client-side so we can
// match rows against the client's saved property register.

const ABBR: Record<string, string> = {
  rd: 'road', st: 'street', ave: 'avenue', av: 'avenue', cl: 'close',
  dr: 'drive', ln: 'lane', ct: 'court', rd_: 'road',
};

export function normalizeForMatch(s: string): string {
  const base = (s || '').toLowerCase().replace(/[.,]/g, ' ').replace(/\s+/g, ' ').trim();
  return base.split(' ').map(w => ABBR[w] ?? w).join(' ');
}

/**
 * Match a free-text address to a registered property.
 * Returns the property id, or null when there's no confident match.
 */
export function matchProperty(address: string, properties: LandlordProperty[]): string | null {
  const a = normalizeForMatch(address);
  if (!a) return null;
  // 1. exact normalized match
  for (const p of properties) {
    if (normalizeForMatch(p.address) === a) return p.id;
  }
  // 2. partial vs full — one is a prefix of the other (ignoring punctuation)
  for (const p of properties) {
    const pn = normalizeForMatch(p.address);
    if (pn && (pn.startsWith(a) || a.startsWith(pn))) return p.id;
  }
  return null;
}

/** Address of the property that owns everything we can't match to a real one —
 *  lets general costs (accountancy, use of home…) be shared out like a property. */
export const UNALLOCATED_LABEL = 'Non Allocated';

export function findUnallocatedProperty(properties: LandlordProperty[]): LandlordProperty | null {
  const want = normalizeForMatch(UNALLOCATED_LABEL);
  return properties.find(p => normalizeForMatch(p.address) === want) ?? null;
}

// ─── Per-person split ────────────────────────────────────────────────────────

export interface PersonBreakdownRow {
  key: string;              // client id, or `name:<lowercased>` for named owners
  name: string;
  clientId: string | null;  // set when the owner is a linked client (SA bridge)
  income: number;
  expenses: number;
}

export interface PersonBreakdown {
  people: PersonBreakdownRow[];
  /** Rows whose address didn't match any registered property. */
  unallocated: { income: number; expenses: number };
  /** Matched properties whose owner shares sum to < 100% — the missing slice. */
  unaccountedShare: { income: number; expenses: number };
}

interface Amounted { PropertyAddress: string; Amount: number }

/**
 * Split the portfolio income/expenses across the people who own each property.
 * The primary landlord's share is the property's `ownership_pct`; additional
 * owners come from `property.owners`. Rows that don't match a property, and the
 * slice of a property not covered by any recorded owner, are reported separately
 * so nothing silently disappears.
 */
export function computePersonBreakdown(
  income: Amounted[],
  expenses: Amounted[],
  properties: LandlordProperty[],
  primaryClient: { id: string | null; name: string },
): PersonBreakdown {
  // Totals per matched property id.
  const incomeByProp = new Map<string, number>();
  const expenseByProp = new Map<string, number>();
  const unallocated = { income: 0, expenses: 0 };
  // When the client has an "Non Allocated" property set up, rows that match no
  // property fall into it so general costs (accountancy, use of home…) can be
  // shared out too. Otherwise they stay in the unallocated bucket.
  const unallocProp = findUnallocatedProperty(properties);

  const bucket = (rows: Amounted[], target: Map<string, number>, un: 'income' | 'expenses') => {
    for (const r of rows) {
      const pid = matchProperty(r.PropertyAddress, properties) ?? unallocProp?.id ?? null;
      if (pid) target.set(pid, (target.get(pid) ?? 0) + (r.Amount || 0));
      else unallocated[un] += (r.Amount || 0);
    }
  };
  bucket(income, incomeByProp, 'income');
  bucket(expenses, expenseByProp, 'expenses');

  const people = new Map<string, PersonBreakdownRow>();
  const unaccountedShare = { income: 0, expenses: 0 };

  const add = (key: string, name: string, clientId: string | null, inc: number, exp: number) => {
    const cur = people.get(key) ?? { key, name, clientId, income: 0, expenses: 0 };
    cur.income += inc;
    cur.expenses += exp;
    // Prefer a client-linked identity if we ever see one for this key.
    if (clientId && !cur.clientId) cur.clientId = clientId;
    people.set(key, cur);
  };

  for (const p of properties) {
    const inc = incomeByProp.get(p.id) ?? 0;
    const exp = expenseByProp.get(p.id) ?? 0;
    if (inc === 0 && exp === 0) continue;

    // Primary landlord share. A 0% owner has been removed from this property —
    // skip them entirely rather than listing a £0 person.
    const primaryPct = Math.max(0, Math.min(100, p.ownership_pct));
    const primaryKey = primaryClient.id ?? `name:${primaryClient.name.toLowerCase()}`;
    if (primaryPct > 0) {
      add(primaryKey, primaryClient.name, primaryClient.id, inc * primaryPct / 100, exp * primaryPct / 100);
    }

    let accounted = primaryPct;
    for (const o of p.owners) {
      const pct = Math.max(0, Math.min(100, o.share_pct));
      accounted += pct;
      if (pct <= 0) continue;
      const key = o.owner_client_id ?? `name:${o.owner_name.toLowerCase()}`;
      add(key, o.owner_name, o.owner_client_id, inc * pct / 100, exp * pct / 100);
    }

    const gap = Math.max(0, 100 - accounted);
    if (gap > 0.001) {
      unaccountedShare.income += inc * gap / 100;
      unaccountedShare.expenses += exp * gap / 100;
    }
  }

  return {
    people: Array.from(people.values()).sort((a, b) => (b.income - b.expenses) - (a.income - a.expenses)),
    unallocated,
    unaccountedShare,
  };
}

// ─── Per-person matrix (property × individual × category) ────────────────────
// The full working: every property is split into its owners (with their %), and
// each income/expense category is shared out to them. Drives the By-Person table
// on screen and in the PDF/export.

export interface MatrixOwner { key: string; name: string; pct: number; clientId: string | null }
export interface MatrixProperty { id: string; address: string; owners: MatrixOwner[] }
export interface MatrixPerson { key: string; name: string; clientId: string | null }

export interface PersonMatrix {
  properties: MatrixProperty[];
  /** Distinct people across every property — used for the per-person total columns. */
  people: MatrixPerson[];
  incomeCats: string[];
  expenseCats: string[];
  /** `${propertyId}|${ownerKey}|${category}` → that owner's share of the category. */
  cells: Map<string, number>;
  /** Amounts that couldn't be attributed to any property (no Non Allocated property set up). */
  unattributed: { income: number; expenses: number };
}

interface Categorised { PropertyAddress: string; Amount: number; Category: string }

export function matrixCell(m: PersonMatrix, propertyId: string, ownerKey: string, category: string): number {
  return m.cells.get(`${propertyId}|${ownerKey}|${category}`) ?? 0;
}

export function computePersonMatrix(
  income: Categorised[],
  expenses: Categorised[],
  properties: LandlordProperty[],
  primaryClient: { id: string | null; name: string },
): PersonMatrix {
  const unallocProp = findUnallocatedProperty(properties);
  const primaryKey = primaryClient.id ?? `name:${primaryClient.name.toLowerCase()}`;

  // Owners of a property, excluding anyone on 0% (i.e. removed from it).
  const ownersOf = (p: LandlordProperty): MatrixOwner[] => {
    const list: MatrixOwner[] = [];
    const primaryPct = Math.max(0, Math.min(100, p.ownership_pct));
    if (primaryPct > 0) list.push({ key: primaryKey, name: primaryClient.name, pct: primaryPct, clientId: primaryClient.id });
    for (const o of p.owners) {
      const pct = Math.max(0, Math.min(100, o.share_pct));
      if (pct <= 0) continue;
      list.push({ key: o.owner_client_id ?? `name:${o.owner_name.toLowerCase()}`, name: o.owner_name, pct, clientId: o.owner_client_id });
    }
    return list;
  };

  const cells = new Map<string, number>();
  const incomeCatSet = new Set<string>();
  const expenseCatSet = new Set<string>();
  const unattributed = { income: 0, expenses: 0 };
  const usedPropIds = new Set<string>();

  const feed = (rows: Categorised[], catSet: Set<string>, un: 'income' | 'expenses') => {
    for (const r of rows) {
      const amount = r.Amount || 0;
      const pid = matchProperty(r.PropertyAddress, properties) ?? unallocProp?.id ?? null;
      const prop = pid ? properties.find(p => p.id === pid) : null;
      if (!prop) { unattributed[un] += amount; continue; }
      const cat = (r.Category || '').trim() || 'Uncategorised';
      catSet.add(cat);
      usedPropIds.add(prop.id);
      for (const o of ownersOf(prop)) {
        const k = `${prop.id}|${o.key}|${cat}`;
        cells.set(k, (cells.get(k) ?? 0) + amount * o.pct / 100);
      }
    }
  };
  feed(income, incomeCatSet, 'income');
  feed(expenses, expenseCatSet, 'expenses');

  const matrixProps: MatrixProperty[] = properties
    .filter(p => usedPropIds.has(p.id))
    .map(p => ({ id: p.id, address: p.address, owners: ownersOf(p) }));

  const peopleMap = new Map<string, MatrixPerson>();
  for (const mp of matrixProps) {
    for (const o of mp.owners) {
      if (!peopleMap.has(o.key)) peopleMap.set(o.key, { key: o.key, name: o.name, clientId: o.clientId });
    }
  }

  return {
    properties: matrixProps,
    people: Array.from(peopleMap.values()),
    incomeCats: Array.from(incomeCatSet).sort((a, b) => a.localeCompare(b)),
    expenseCats: Array.from(expenseCatSet).sort((a, b) => a.localeCompare(b)),
    cells,
    unattributed,
  };
}
