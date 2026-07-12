// Billing module — invoice import engine.
//
// Parses a CSV/Excel export (via xlsx), figures out which column is which
// (preset signatures for the big systems, else a generic guess, else AI in the
// API layer), normalises every row to a common invoice shape, and fuzzy-matches
// each row's client name to an existing SMITH client. All pure/deterministic
// except the optional AI mapping, which lives in the API and feeds back here.

import * as XLSX from 'xlsx';

export type ImportField = 'number' | 'clientName' | 'issueDate' | 'dueDate' | 'total' | 'amountPaid' | 'balance' | 'status' | 'description';
export type ColumnMapping = Partial<Record<ImportField, number>>;
export type RowStatus = 'paid' | 'part_paid' | 'outstanding' | 'skip';

export interface NormalizedRow {
  number: string | null;
  clientName: string;
  issueDate: string | null;
  dueDate: string | null;
  totalPence: number;
  amountPaidPence: number;
  status: RowStatus;
  description: string;
}

export interface ParsedSheet { headers: string[]; rows: string[][] }

interface Preset {
  id: string; label: string;
  signature: string[];                        // all must appear (substring) in headers
  map: Partial<Record<ImportField, string[]>>; // candidate header substrings per field
}

// Generic header candidates (used when no preset matches, and as AI fallback hints).
const GENERIC: Record<ImportField, string[]> = {
  number: ['invoice number', 'invoice no', 'invoiceno', 'invoice #', 'inv no', 'doc number', 'number', 'reference', 'ref'],
  clientName: ['contact', 'customer', 'client', 'account name', 'company', 'name', 'billed to', 'to'],
  issueDate: ['invoice date', 'issue date', 'date issued', 'created', 'date'],
  dueDate: ['due date', 'date due', 'due'],
  total: ['invoice total', 'total (gbp)', 'gross', 'total amount', 'amount incl', 'total'],
  amountPaid: ['amount paid', 'paid', 'received'],
  balance: ['balance', 'amount due', 'outstanding', 'owing'],
  status: ['status', 'state'],
  description: ['description', 'details', 'memo', 'line description', 'item'],
};

const PRESETS: Preset[] = [
  {
    id: 'xero', label: 'Xero', signature: ['contact', 'invoice number'],
    map: { number: ['invoice number'], clientName: ['contact'], issueDate: ['invoice date', 'date'], dueDate: ['due date'], total: ['total'], amountPaid: ['paid'], balance: ['amount due', 'balance'], status: ['status'], description: ['description', 'reference'] },
  },
  {
    id: 'quickbooks', label: 'QuickBooks', signature: ['customer', 'open balance'],
    map: { number: ['num', 'number'], clientName: ['customer'], issueDate: ['date'], dueDate: ['due date'], total: ['amount', 'total'], balance: ['open balance', 'balance'], status: ['status'], description: ['memo', 'description'] },
  },
  {
    id: 'sage', label: 'Sage', signature: ['customer', 'gross'],
    map: { number: ['invoice', 'number', 'reference'], clientName: ['customer', 'account'], issueDate: ['date'], dueDate: ['due'], total: ['gross', 'total'], balance: ['outstanding', 'balance'], status: ['status'], description: ['details', 'description'] },
  },
  {
    id: 'vt', label: 'VT Transaction+', signature: ['account', 'net'],
    map: { number: ['reference', 'ref'], clientName: ['account', 'customer'], issueDate: ['date'], dueDate: ['due'], total: ['gross', 'total', 'amount'], balance: ['outstanding'], status: ['status'], description: ['details', 'narrative'] },
  },
];

// ── Parsing ──────────────────────────────────────────────────────────────────
export function parseWorkbook(base64: string): ParsedSheet {
  const wb = XLSX.read(base64, { type: 'base64', cellDates: true });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const grid = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, blankrows: false, raw: false, dateNF: 'yyyy-mm-dd' }) as unknown[][];
  // Header row = first row with >= 3 non-empty cells.
  let headerIdx = grid.findIndex(r => r.filter(c => String(c ?? '').trim() !== '').length >= 3);
  if (headerIdx < 0) headerIdx = 0;
  const headers = (grid[headerIdx] ?? []).map(c => String(c ?? '').trim());
  const rows = grid.slice(headerIdx + 1)
    .map(r => headers.map((_, i) => String(r[i] ?? '').trim()))
    .filter(r => r.some(c => c !== ''));
  return { headers, rows };
}

// ── Mapping ──────────────────────────────────────────────────────────────────
export function detectPreset(headers: string[]): Preset | null {
  const h = headers.map(x => x.toLowerCase());
  return PRESETS.find(p => p.signature.every(sig => h.some(header => header.includes(sig)))) ?? null;
}

function findCol(headers: string[], candidates: string[]): number {
  const h = headers.map(x => x.toLowerCase());
  // Prefer exact, then substring, in candidate order.
  for (const cand of candidates) { const i = h.indexOf(cand); if (i >= 0) return i; }
  for (const cand of candidates) { const i = h.findIndex(header => header.includes(cand)); if (i >= 0) return i; }
  return -1;
}

export function buildMapping(headers: string[], preset: Preset | null): ColumnMapping {
  const fields: ImportField[] = ['number', 'clientName', 'issueDate', 'dueDate', 'total', 'amountPaid', 'balance', 'status', 'description'];
  const mapping: ColumnMapping = {};
  for (const f of fields) {
    const cands = preset?.map[f] ?? GENERIC[f];
    const i = findCol(headers, cands);
    if (i >= 0) mapping[f] = i;
  }
  return mapping;
}

/** Convert an AI field→header-name map to column indices. */
export function mappingFromNames(headers: string[], byName: Partial<Record<ImportField, string>>): ColumnMapping {
  const h = headers.map(x => x.toLowerCase());
  const mapping: ColumnMapping = {};
  for (const [field, name] of Object.entries(byName)) {
    if (!name) continue;
    const i = h.indexOf(String(name).toLowerCase());
    if (i >= 0) mapping[field as ImportField] = i;
  }
  return mapping;
}

/** A mapping is "good enough" to skip AI when it has a client, a total, and a number or date. */
export function mappingIsUsable(m: ColumnMapping): boolean {
  return m.clientName != null && m.total != null && (m.number != null || m.issueDate != null);
}

// ── Value parsing ────────────────────────────────────────────────────────────
export function parseAmountPence(s: string): number {
  if (!s) return 0;
  const neg = /^\(.*\)$/.test(s.trim()) || s.trim().startsWith('-');
  const n = parseFloat(s.replace(/[()£$,\s]/g, '').replace(/-/g, ''));
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) * (neg ? -1 : 1);
}

export function parseDate(s: string): string | null {
  const t = (s ?? '').trim();
  if (!t) return null;
  let m = t.match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  // dd/mm/yyyy or dd-mm-yyyy (UK). Also accept 2-digit year.
  m = t.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2,4})/);
  if (m) {
    const [, d, mo, yRaw] = m;
    const y = yRaw.length === 2 ? `20${yRaw}` : yRaw;
    return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  // "12 Mar 2026"
  const parsed = Date.parse(t);
  if (!Number.isNaN(parsed)) return new Date(parsed).toISOString().slice(0, 10);
  return null;
}

function inferStatus(statusText: string, totalPence: number, amountPaidPence: number): RowStatus {
  const s = statusText.toLowerCase();
  if (s && /(void|deleted|cancel|credited)/.test(s)) return 'skip';
  if (s && /(paid|settled|closed)/.test(s)) return 'paid';
  if (amountPaidPence >= totalPence && totalPence > 0) return 'paid';
  if (amountPaidPence > 0) return 'part_paid';
  return 'outstanding';
}

export function normalizeRows(headers: string[], rows: string[][], mapping: ColumnMapping): NormalizedRow[] {
  const get = (r: string[], f: ImportField) => (mapping[f] != null ? (r[mapping[f]!] ?? '') : '');
  const out: NormalizedRow[] = [];
  for (const r of rows) {
    const clientName = get(r, 'clientName').trim();
    const totalPence = Math.abs(parseAmountPence(get(r, 'total')));
    if (!clientName && totalPence === 0) continue; // blank/subtotal line
    // Derive amount paid: explicit, else total − balance.
    let amountPaidPence = mapping.amountPaid != null ? parseAmountPence(get(r, 'amountPaid')) : NaN;
    if (!Number.isFinite(amountPaidPence)) {
      const bal = mapping.balance != null ? Math.abs(parseAmountPence(get(r, 'balance'))) : NaN;
      amountPaidPence = Number.isFinite(bal) ? Math.max(0, totalPence - bal) : 0;
    }
    amountPaidPence = Math.min(Math.max(0, amountPaidPence), totalPence);
    const status = inferStatus(get(r, 'status'), totalPence, amountPaidPence);
    out.push({
      number: get(r, 'number').trim() || null,
      clientName: clientName || 'Unknown',
      issueDate: parseDate(get(r, 'issueDate')),
      dueDate: parseDate(get(r, 'dueDate')),
      totalPence,
      amountPaidPence,
      status,
      description: get(r, 'description').trim(),
    });
  }
  return out;
}

// ── Client matching ──────────────────────────────────────────────────────────
export interface ClientLite { id: string; name: string }
export interface ClientMatch { clientId: string | null; confidence: 'high' | 'medium' | 'none' }

function norm(s: string): string { return s.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim(); }
function tokens(name: string): string[] {
  const stop = new Set(['ltd', 'limited', 'llp', 'plc', 'the', 'and', 'co', 'uk', 'services', 'group']);
  return norm(name).split(' ').filter(t => t.length >= 3 && !stop.has(t));
}

export function matchClient(name: string, clients: ClientLite[]): ClientMatch {
  const target = norm(name);
  if (!target) return { clientId: null, confidence: 'none' };
  const exact = clients.find(c => norm(c.name) === target);
  if (exact) return { clientId: exact.id, confidence: 'high' };
  const tt = tokens(name);
  if (!tt.length) return { clientId: null, confidence: 'none' };
  const scored = clients
    .map(c => { const ct = tokens(c.name); const overlap = tt.filter(t => ct.includes(t)).length; return { c, overlap, ratio: overlap / Math.max(tt.length, ct.length || 1) }; })
    .filter(s => s.overlap > 0)
    .sort((a, b) => b.ratio - a.ratio);
  if (scored.length && scored[0].ratio >= 0.6 && (scored.length === 1 || scored[0].ratio > scored[1].ratio)) {
    return { clientId: scored[0].c.id, confidence: 'medium' };
  }
  return { clientId: null, confidence: 'none' };
}

export function presetLabel(id: string | null): string {
  return PRESETS.find(p => p.id === id)?.label ?? 'Generic export';
}
