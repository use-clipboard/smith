// Client-side helpers for the Capture "Ask SMITH" review chat.
//
// Mirrors the Tax Studio scan-chat pattern (see components/features/tax-studio/
// extract.ts): SMITH sees a compact snapshot of the extracted transactions —
// both the VALID ones and the ones the scan FLAGGED (duplicates, calc errors,
// anomalies) — and proposes structured EDITS the user applies with one click:
//   - recode : change a valid transaction's account/category
//   - update : fix a valid transaction's amounts (net/vat/gross), description, date
//   - flag   : move a valid transaction to the flagged list (e.g. a duplicate)
//   - unflag : restore a flagged item back to the valid list (e.g. "not a dupe")
//
// Transactions are a union across 8 target-software shapes, so every field access
// goes through the per-software FIELDS map below. The account-write rules match
// handleBulkAccountChange in the Capture page exactly.

import type { Transaction, TargetSoftware, FlaggedEntry } from '@/types';

// ── Per-software field map ──────────────────────────────────────────────────
interface FieldMap {
  account?: string;          // field written on `recode` (an account NAME)
  accountCodeClear?: string; // companion code field blanked on recode (Capium/Xero/QB)
  label: string;             // description/details field
  contact?: string;          // supplier/contact field
  date: string;
  net: string;
  vat?: string;
  gross?: string;            // absent = no explicit gross field (gross ≈ net + vat)
}

const FIELDS: Record<TargetSoftware, FieldMap> = {
  smith:      { account: 'analysisAccount', label: 'description', contact: 'contactName',   date: 'date',        net: 'netAmount', vat: 'vatAmount',  gross: 'grossAmount' },
  vt:         { account: 'analysisAccount', label: 'details',     contact: 'primaryAccount', date: 'date',        net: 'analysis',  vat: 'vat',        gross: 'total' },
  capium:     { account: 'accountname', accountCodeClear: 'accountcode', label: 'description', contact: 'contactname', date: 'invoicedate', net: 'netAmount', vat: 'vatamount', gross: 'amount' },
  xero:       { account: 'accountName', accountCodeClear: 'accountCode', label: 'description', contact: 'contactName', date: 'invoiceDate', net: 'unitAmount', gross: 'grossAmount' },
  quickbooks: { account: 'accountName', accountCodeClear: 'accountCode', label: 'description', contact: 'supplier', date: 'invoiceDate', net: 'unitAmount', vat: 'vatAmount', gross: 'grossAmount' },
  freeagent:  { label: 'description', date: 'date', net: 'amount', gross: 'amount' },
  sage:       { account: 'NOMINAL_CODE', label: 'DETAILS', contact: 'ACCOUNT_REF', date: 'DATE', net: 'NET_AMOUNT', vat: 'TAX_AMOUNT' },
  general:    { account: 'category', label: 'description', contact: 'supplier', date: 'date', net: 'netAmount', vat: 'vatAmount', gross: 'grossAmount' },
};

// ── Coercion helpers ────────────────────────────────────────────────────────
function rec(tx: Transaction): Record<string, unknown> { return tx as unknown as Record<string, unknown>; }
function str(v: unknown): string { return typeof v === 'string' ? v : v == null ? '' : String(v); }
function num(v: unknown): number { return typeof v === 'number' && isFinite(v) ? v : 0; }

function readNet(tx: Transaction, sw: TargetSoftware): number { return num(rec(tx)[FIELDS[sw].net]); }
function readVat(tx: Transaction, sw: TargetSoftware): number { const f = FIELDS[sw].vat; return f ? num(rec(tx)[f]) : 0; }
function readGross(tx: Transaction, sw: TargetSoftware): number {
  const f = FIELDS[sw].gross;
  // Sage (and any software without an explicit gross column) has no gross field —
  // derive it from net + tax so the proposal still shows a meaningful total.
  return f ? num(rec(tx)[f]) : readNet(tx, sw) + readVat(tx, sw);
}
function readAccount(tx: Transaction, sw: TargetSoftware): string { const f = FIELDS[sw].account; return f ? str(rec(tx)[f]) : ''; }
function readLabel(tx: Transaction, sw: TargetSoftware): string { return str(rec(tx)[FIELDS[sw].label]); }
function readContact(tx: Transaction, sw: TargetSoftware): string { const f = FIELDS[sw].contact; return f ? str(rec(tx)[f]) : ''; }
function readDate(tx: Transaction, sw: TargetSoftware): string { return str(rec(tx)[FIELDS[sw].date]); }

// Stable content key for a row — used to re-locate the exact transaction at
// apply time even if the list has since been re-sorted or had rows removed.
// Deliberately not the array index (which shifts) and not just the description
// (which repeats). fileName + page + rounded gross + a slug of the label is
// unique enough in practice for a single analysis batch.
export function captureRowKey(tx: Transaction, sw: TargetSoftware): string {
  return [
    str(rec(tx).fileName),
    num(rec(tx).pageNumber),
    Math.round(readGross(tx, sw) * 100),
    readLabel(tx, sw).slice(0, 24).toLowerCase().replace(/\s+/g, ' ').trim(),
  ].join('|');
}

// A flagged entry's display fields — from its underlying transaction when the
// scan kept one, otherwise from the entry's own summary fields.
function flaggedFields(entry: FlaggedEntry, sw: TargetSoftware) {
  if (entry.transactionData) {
    const tx = entry.transactionData;
    return { label: readLabel(tx, sw), contact: readContact(tx, sw), account: readAccount(tx, sw), net: readNet(tx, sw), vat: readVat(tx, sw), gross: readGross(tx, sw), date: readDate(tx, sw) };
  }
  return { label: entry.description ?? '', contact: entry.supplier ?? '', account: '', net: 0, vat: 0, gross: entry.amount ?? 0, date: entry.date ?? '' };
}

// Stable key for a flagged entry. Prefixed with "F|" so it can never collide
// with a valid-transaction key.
export function flaggedKey(entry: FlaggedEntry, sw: TargetSoftware): string {
  const f = flaggedFields(entry, sw);
  return ['F', str(entry.fileName), num(entry.pageNumber), Math.round(f.gross * 100), f.label.slice(0, 24).toLowerCase().replace(/\s+/g, ' ').trim()].join('|');
}

// ── Proposal snapshot the AI sees ───────────────────────────────────────────
export interface CaptureProposal {
  ref: number;                      // 1-based number the AI references in its edits
  key: string;                      // stable content key (not sent to the AI)
  section: 'valid' | 'flagged';
  label: string;
  contact: string;
  account: string;
  net: number;
  vat: number;
  gross: number;
  date: string;
  reason?: string;                  // flagged only: why the scan flagged it
}

// Build the combined proposal list: valid transactions first (refs 1..N), then
// flagged entries (refs N+1..N+M). Refs are contiguous so the AI addresses any
// row by a single number and we recover its section from the proposal it maps to.
export function buildCaptureProposals(valid: Transaction[], flagged: FlaggedEntry[], sw: TargetSoftware): CaptureProposal[] {
  const validProps: CaptureProposal[] = valid.map((tx, i) => ({
    ref: i + 1,
    key: captureRowKey(tx, sw),
    section: 'valid',
    label: readLabel(tx, sw),
    contact: readContact(tx, sw),
    account: readAccount(tx, sw),
    net: readNet(tx, sw),
    vat: readVat(tx, sw),
    gross: readGross(tx, sw),
    date: readDate(tx, sw),
  }));
  const flaggedProps: CaptureProposal[] = flagged.map((entry, j) => {
    const f = flaggedFields(entry, sw);
    return { ref: valid.length + j + 1, key: flaggedKey(entry, sw), section: 'flagged', ...f, reason: entry.reason };
  });
  return [...validProps, ...flaggedProps];
}

// ── Edits ───────────────────────────────────────────────────────────────────
export interface CaptureEdit {
  action: 'recode' | 'update' | 'flag' | 'unflag';
  ref: number;                       // which proposal (1-based) this targets
  key?: string;                      // resolved from ref at receive time (never from the model)
  section?: 'valid' | 'flagged';     // resolved from ref
  account?: string;                  // recode: new account/category NAME
  fields?: {                         // update: any subset
    description?: string;
    date?: string;
    net?: number;
    vat?: number;
    gross?: number;
  };
  reason?: string;                   // shown on the Apply chip
}

// Attach the stable content key + section to each edit by resolving its `ref`
// against the proposal list the AI was shown this turn. Edits with an
// out-of-range ref are dropped (the model referenced a row that no longer exists).
export function resolveEditKeys(edits: CaptureEdit[], proposals: CaptureProposal[]): CaptureEdit[] {
  return edits
    .map((e): CaptureEdit | null => {
      const p = proposals.find(pr => pr.ref === e.ref);
      return p ? { ...e, key: p.key, section: p.section } : null;
    })
    .filter((e): e is CaptureEdit => e !== null);
}

function setAccount(target: Record<string, unknown>, sw: TargetSoftware, value: string): void {
  const map = FIELDS[sw];
  if (!map.account) return;                 // FreeAgent has no account field
  target[map.account] = value;
  if (map.accountCodeClear) target[map.accountCodeClear] = ''; // name changed → code no longer valid
}

function setFields(target: Record<string, unknown>, sw: TargetSoftware, f: NonNullable<CaptureEdit['fields']>): void {
  const map = FIELDS[sw];
  if (f.description != null) target[map.label] = f.description;
  if (f.date != null) target[map.date] = f.date;
  if (f.net != null) target[map.net] = f.net;
  if (f.vat != null && map.vat) target[map.vat] = f.vat;
  if (f.gross != null && map.gross) target[map.gross] = f.gross;
  // Keep the arithmetic consistent: if net/vat moved but gross wasn't given,
  // recompute it so the row doesn't read as a calc error.
  if (f.gross == null && (f.net != null || f.vat != null) && map.gross) {
    target[map.gross] = num(target[map.net]) + (map.vat ? num(target[map.vat]) : 0);
  }
}

export interface CaptureEditResult {
  transactions: Transaction[];       // the new valid-transactions list
  flagged: FlaggedEntry | null;      // a new flagged entry to append (flag action), else null
  applied: boolean;                  // false = target row not found (no-op)
}

// Apply one recode/update/flag edit that targets a VALID transaction. Pure —
// returns new state; the page commits it via pushHistory / setFlaggedEntries.
// (Flagged-item edits — unflag — are handled in the page, which owns the
// flagged list and the transaction-rebuild helper.)
export function applyCaptureEdit(txs: Transaction[], sw: TargetSoftware, edit: CaptureEdit): CaptureEditResult {
  const idx = edit.key
    ? txs.findIndex(t => captureRowKey(t, sw) === edit.key)
    : edit.ref - 1;                  // fallback when no key was resolved
  if (idx < 0 || idx >= txs.length) return { transactions: txs, flagged: null, applied: false };

  if (edit.action === 'flag') {
    const tx = txs[idx];
    const flagged: FlaggedEntry = {
      fileName: str(rec(tx).fileName),
      reason: edit.reason || 'Flagged by SMITH',
      pageNumber: num(rec(tx).pageNumber),
      description: readLabel(tx, sw),
      supplier: readContact(tx, sw),
      amount: readGross(tx, sw),
      date: readDate(tx, sw),
      transactionData: tx,
    };
    return { transactions: txs.filter((_, i) => i !== idx), flagged, applied: true };
  }

  const next = txs.map((tx, i) => {
    if (i !== idx) return tx;
    const clone = { ...(tx as unknown as Record<string, unknown>) };
    if (edit.action === 'recode' && edit.account != null) setAccount(clone, sw, edit.account);
    if (edit.action === 'update' && edit.fields) setFields(clone, sw, edit.fields);
    return clone as unknown as Transaction;
  });
  return { transactions: next, flagged: null, applied: true };
}

// ── One chat turn ───────────────────────────────────────────────────────────
export interface CaptureChatContext {
  clientName: string;
  isVatRegistered: boolean;
  targetSoftware: TargetSoftware;
  accountLabel: string;                         // "Analysis Account" / "Nominal Code" / …
  accounts: string[];                           // chart-of-accounts vocabulary for recodes
  proposals: { ref: number; label: string; contact: string; account: string; net: number; vat: number; gross: number; date: string }[];
  flagged: { ref: number; label: string; contact: string; amount: number; date: string; reason: string }[];
}

export async function fetchCaptureChat(payload: CaptureChatContext & {
  messages: { role: 'user' | 'assistant'; content: string }[];
}): Promise<{ reply: string; edits: CaptureEdit[] }> {
  const r = await fetch('/api/full-analysis/chat', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
  });
  const ct = r.headers.get('content-type') ?? '';
  const d = ct.includes('application/json') ? await r.json().catch(() => ({})) : {};
  if (!r.ok) throw new Error((d as { error?: string }).error ?? 'SMITH is unavailable right now.');
  const edits = Array.isArray((d as { edits?: unknown }).edits) ? ((d as { edits: CaptureEdit[] }).edits) : [];
  return { reply: String((d as { reply?: string }).reply ?? ''), edits };
}
