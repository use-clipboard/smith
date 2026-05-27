'use client';

/**
 * ManualBankRecSheet — VT-style "bank cash book" multi-type entry sheet.
 *
 * Visual style mirrors UniversalInputSheet so users only learn one entry
 * model. Differences vs the input sheet:
 *   • TYPE is per-row (PAY / CHQ / REC / TRF), not a global selector.
 *   • Rows are tinted by type:
 *       PAY → red    REC → green    CHQ → orange    TRF → blue
 *     The tint is light enough to read but bold enough that you can scan a
 *     long sheet and see at a glance which rows are which.
 *   • VAT defaults to "No VAT" (accountants don't usually reclaim VAT
 *     directly off bank statements without an invoice). VAT/Net columns
 *     are hidden entirely on non-VAT-registered books.
 *   • Keyboard:
 *       - In the TYPE cell, P = PAY, R = REC, C = CHQ, T = TRF.
 *       - Tab on the last cell of the last row appends a new row and
 *         focuses its TYPE cell.
 *
 * On Post the whole sheet is sent to
 *   POST /api/bookkeeping/books/<id>/bank-imports/manual
 * which posts each row as a real transaction AND creates a reconciled
 * bookkeeping_bank_lines row matched to the bank-side split.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { X, Plus, Loader2, Trash2, Pencil, AlertCircle, Check, Sparkles, HelpCircle, Bot } from 'lucide-react';
import Tooltip from '@/components/ui/Tooltip';
import DuplicateReviewModal, { type DupeSuspect } from './DuplicateReviewModal';
import { useTransactionRowActions } from '../transactions/useTransactionRowActions';
import type { Transaction, TransactionType as TxType } from '@/types/bookkeeping';

interface ManualDupeSuspect {
  row_index: number;
  row: { type: string; date: string; payee_text: string | null; total: number };
  match: { ref_no: string; date: string; signed_amount: number; details: string | null };
}
import DateInput, { parseUkDateStrict, fromIso } from '../input/DateInput';
import LedgerPicker from '../input/LedgerPicker';
import AccountPicker from '../input/AccountPicker';
import PayeeAutocomplete from '../input/PayeeAutocomplete';
import VatTreatmentPicker from '../input/VatTreatmentPicker';
import {
  VAT_TREATMENT_OPTIONS,
  type BookAccountRef, type VatTreatment, type TransactionType,
} from '@/types/bookkeeping';

type RowType = 'PAY' | 'CHQ' | 'REC' | 'TRF';

interface Props {
  bookId: string;
  accountId: string;
  accountName: string;
  vatRegistered: boolean;
  /** Optional ISO date used as the FIRST row's default. Typically the
   *  active rec's period_end so the user can crack through end-of-month
   *  statement entries without re-typing the date on every row. Once a
   *  first row has been entered, subsequent rows inherit its date via the
   *  appendRow carry-forward already wired below. */
  defaultDateIso?: string | null;
  /** Rec period boundaries used to warn (soft, not hard-block) when a
   *  row's date lands outside the rec window. Catches the common typo
   *  "wrote 2025 instead of 2024" before it widens the rec period
   *  silently on save. Both optional — when unset no warning fires. */
  periodStartIso?: string | null;
  periodEndIso?: string | null;
  /** VAT lock date threaded through to the per-row Edit modal so the
   *  "filed VAT period" guard fires correctly when the user fixes a
   *  historical entry via the sheet's right-click context menu. */
  vatLockDate?: string | null;
  /** Fires when an EXISTING entry was edited or deleted via the sheet's
   *  right-click menu. Lets the parent reload the workspace so the merged
   *  list refreshes with the new state. */
  onExistingChanged?: () => void;
  /** Optional initial draft rows — used by the CSV-as-entries flow to
   *  pre-populate the sheet from parsed CSV lines instead of opening
   *  with a single blank row. Each seed sets the row's type / date /
   *  payee / total; ledger + analysis stay blank for the user (or the
   *  forthcoming auto-allocate step) to fill in. */
  seedRows?: ManualSeedRow[];
}

/** Pre-populated row shape used to seed the sheet from a CSV import.
 *  Intentionally a subset of RowDraft — we never seed VAT treatment,
 *  analysis account, or entry-details because those require human (or
 *  rule-based) judgement based on context. */
export interface ManualSeedRow {
  type: 'PAY' | 'REC' | 'CHQ' | 'TRF';
  /** dd/mm/yyyy — same format the rest of the sheet uses. */
  dateUk: string;
  payee: string;
  /** Pre-formatted gross amount as a string, e.g. "9.35". */
  totalText: string;
  /** Optional. When provided the posted rows attach to this active rec
   *  rather than creating a sibling import. Used by the period-first
   *  Reconcile workspace's Manual entry chip. */
  existingImportId?: string;
  /** Bank statement opening balance the running-balance walk starts from.
   *  Only relevant when rendering existing entries inline. */
  openingBalance?: number;
  /** Existing splits on the bank account to render inline (in muted
   *  read-only style) alongside the draft rows. Helps the user spot
   *  duplicates and verify the running balance as they type. Ordering is
   *  always by date — drafts slot into chronological position. */
  existingEntries?: ExistingEntry[];
  onClose: () => void;
  /** Called when the post succeeds. Returns the import_id (existing or
   *  freshly created) so the caller can refresh or navigate. */
  onPosted: (importId: string) => void;
}

/** Existing ledger entry on the bank account, rendered as a muted
 *  read-only row in the merged sheet. The shape is intentionally minimal
 *  — only what we need to display + sort + sum. */
export interface ExistingEntry {
  split_id: string;
  transaction_id: string;
  type: string;
  ref_no: string;
  date_iso: string;       // YYYY-MM-DD
  payee: string;
  signed_amount: number;  // debit − credit on the bank account (gross)
  cleared: boolean;
  /** Analysis-side account info, surfaced from the workspace endpoint.
   *  Provides context for the user as they type new manual entries —
   *  which expense / income code did past similar payments hit? */
  analysis_account_name: string | null;
  analysis_ledger: string | null;
  /** Transaction's gross VAT total. Used to compute net = |gross| − vat. */
  vat_total: number;
}

interface RowDraft {
  /** Stable React key. */
  uid: string;
  type: RowType;
  /** dd/mm/yyyy — same format the input sheet stores it in. Converted to
   *  ISO at post time via parseUkDateStrict. */
  date: string;
  payee: string;
  totalText: string;
  vatTreatment: VatTreatment;
  analysisLedger: string;   // drives the AccountPicker's filter
  analysis: BookAccountRef | null;
  entryDetails: string;
}

// ── Type colour palette ─────────────────────────────────────────────────────
// Light enough to keep the inputs legible, distinct enough to spot the type
// at a glance across a long sheet.
const TYPE_TONES: Record<RowType, { row: string; selectText: string }> = {
  PAY: { row: 'bg-rose-50/60    hover:bg-rose-50',    selectText: 'text-rose-800'    },
  REC: { row: 'bg-emerald-50/60 hover:bg-emerald-50', selectText: 'text-emerald-800' },
  CHQ: { row: 'bg-amber-50/60   hover:bg-amber-50',   selectText: 'text-amber-800'   },
  TRF: { row: 'bg-sky-50/70     hover:bg-sky-50',     selectText: 'text-sky-800'     },
};

function rateFor(t: VatTreatment): number {
  return VAT_TREATMENT_OPTIONS.find(o => o.id === t)?.rate ?? 0;
}
function splitVatFromGross(total: number, rate: number) {
  if (rate <= 0) return { vat: 0, net: total };
  const net = +(total / (1 + rate / 100)).toFixed(2);
  return { vat: +(total - net).toFixed(2), net };
}
function parseAmount(s: string): number {
  return parseFloat(s.replace(/[,£\s]/g, '')) || 0;
}
function todayIso(): string { return new Date().toISOString().slice(0, 10); }
function todayUk(): string { return fromIso(todayIso()); }

// PAY / CHQ default analysis ledger = Expenses; REC = Income; TRF = Bank.
function defaultLedgerFor(t: RowType): string {
  if (t === 'TRF') return 'Bank';
  if (t === 'REC') return 'Income';
  return 'Expenses';
}

function makeRow(seed?: Partial<RowDraft>): RowDraft {
  const type = seed?.type ?? 'PAY';
  return {
    uid: `r-${Math.random().toString(36).slice(2, 10)}`,
    type,
    date: seed?.date ?? todayUk(),
    payee: '',
    totalText: '',
    vatTreatment: 'no_vat',
    analysisLedger: defaultLedgerFor(type),
    analysis: null,
    entryDetails: '',
    ...seed,
  };
}

export default function ManualBankRecSheet({
  bookId, accountId, accountName, vatRegistered, existingImportId, defaultDateIso,
  periodStartIso, periodEndIso, vatLockDate,
  openingBalance, existingEntries, onExistingChanged, seedRows, onClose, onPosted,
}: Props) {
  // Seed the first row's date from defaultDateIso if supplied (typically
  // the rec's period_end), otherwise today. Once row 1 exists, appendRow
  // copies forward whatever the user last typed — so reverting a row to
  // today doesn't drag every following row back.
  const initialDate = defaultDateIso ? fromIso(defaultDateIso) : todayUk();
  // Seed the initial row set from CSV-imported lines if provided, else a
  // single blank row dated to the rec's period_end. Initial state is set
  // once at mount — subsequent seedRows prop changes are ignored, because
  // the user has by then been editing the rows and we don't want to wipe
  // their work if the parent happens to re-render with stale seeds.
  const [rows, setRows]     = useState<RowDraft[]>(() => {
    if (seedRows && seedRows.length > 0) {
      return seedRows.map(s => makeRow({
        type:      s.type as RowType,
        date:      s.dateUk,
        payee:     s.payee,
        totalText: s.totalText,
      }));
    }
    return [makeRow({ date: initialDate })];
  });

  /** Auto-allocate state — populated when the user clicks the
   *  "Auto-allocate accounts" button. Per-row keyed by RowDraft.uid so
   *  the indicators stay correct as rows are added/deleted/edited. */
  const [autoAllocating, setAutoAllocating] = useState(false);
  const [allocationByRow, setAllocationByRow] = useState<Map<string, {
    confidence: 'high' | 'medium' | 'low' | null;
    source: 'supplier_match' | 'customer_match' | 'past_payee' | 'amount_only' | 'ai' | 'unallocated';
    reasoning: string | null;
  }>>(new Map());
  /** Set after the last auto-allocate run — explains whether AI was used,
   *  skipped (no key), or wasn't needed (all rule-confident). Shown as a
   *  small status pill so the user knows what happened. */
  const [aiStatus, setAiStatus] = useState<{ used: boolean; reason?: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError]   = useState<string | null>(null);
  const [suspects, setSuspects] = useState<ManualDupeSuspect[] | null>(null);

  // After we add a row via Tab, we want focus to land on the new row's TYPE
  // cell. Track which row id is pending focus so the next render can wire it.
  const pendingFocusRowId = useRef<string | null>(null);
  // Map row uid → ref to the TYPE select, so we can imperatively focus.
  const typeRefs = useRef(new Map<string, HTMLSelectElement | null>());

  // No focus trap — the sheet is rendered as a workspace page (its own rail
  // tab), so Tab can flow naturally to surrounding chrome the same way it
  // does in the regular Input sheet. The page wrapper ref is kept around in
  // case we ever need to scope a query to the sheet (e.g. focus-first-row
  // on mount).
  const modalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!pendingFocusRowId.current) return;
    const el = typeRefs.current.get(pendingFocusRowId.current);
    if (el) el.focus();
    pendingFocusRowId.current = null;
  }, [rows]);

  // ── Row ops ──────────────────────────────────────────────────────────────
  function updateRow(uid: string, patch: Partial<RowDraft>) {
    setRows(prev => prev.map(r => r.uid === uid ? { ...r, ...patch } : r));
  }
  function removeRow(uid: string) {
    setRows(prev => prev.length > 1 ? prev.filter(r => r.uid !== uid) : prev);
  }
  /** Carry forward useful fields from the last row — most sheets are a run
   *  of same-type transactions on consecutive dates. */
  function appendRow() {
    const last = rows[rows.length - 1];
    const next = makeRow({ type: last?.type ?? 'PAY', date: last?.date ?? todayUk() });
    pendingFocusRowId.current = next.uid;
    setRows(prev => [...prev, next]);
    return next;
  }

  /** A row is "ready" once the user has chosen the bits we can't sensibly
   *  default for them: VAT treatment, an analysis ledger, and an analysis
   *  account. (VAT and ledger have defaults so this mostly gates on the
   *  analysis-account pick.) Used to stop the user accidentally Tab-spawning
   *  a forest of half-filled rows. */
  function isRowReadyForNext(r: RowDraft): boolean {
    if (!r.vatTreatment) return false;
    if (!r.analysisLedger) return false;
    if (!r.analysis) return false;
    return true;
  }
  function lastRowReady(): boolean {
    const last = rows[rows.length - 1];
    return !!last && isRowReadyForNext(last);
  }
  function changeType(uid: string, type: RowType) {
    setRows(prev => prev.map(r => r.uid === uid
      ? {
          ...r,
          type,
          analysisLedger: defaultLedgerFor(type),
          analysis: null,
          // TRF has no VAT so force back to no_vat.
          vatTreatment: type === 'TRF' ? 'no_vat' : r.vatTreatment,
        }
      : r));
  }

  // ── Keyboard shortcuts for the TYPE select ───────────────────────────────
  // P/R/C/T flip the type without touching the dropdown — the native select
  // would also act on these keys but we intercept so we map T to TRF (not
  // TRF→native-select's default of picking the option starting with T).
  function onTypeKeyDown(uid: string, e: React.KeyboardEvent<HTMLSelectElement>) {
    const k = e.key.toLowerCase();
    const map: Record<string, RowType | undefined> = { p: 'PAY', r: 'REC', c: 'CHQ', t: 'TRF' };
    const next = map[k];
    if (next) {
      e.preventDefault();
      changeType(uid, next);
    }
  }

  // ── Derived ──────────────────────────────────────────────────────────────
  const derivedRows = useMemo(() => rows.map(r => {
    const total = parseAmount(r.totalText);
    const rate  = r.type === 'TRF' ? 0 : rateFor(r.vatTreatment);
    const { vat, net } = splitVatFromGross(total, rate);
    return { ...r, totalNum: total, vat, net };
  }), [rows]);

  const grandTotal = derivedRows.reduce((s, r) => s + r.totalNum, 0);
  const showVatColumn = vatRegistered;

  /** Per-row out-of-period flag — set when a parseable date sits outside
   *  the rec window. We only flag rows the user has FINISHED entering
   *  (parseUkDateStrict returns ''  for half-typed dates) so the warning
   *  doesn't blink on every keystroke. */
  function isOutOfPeriod(uk: string): boolean {
    if (!periodStartIso && !periodEndIso) return false;
    const iso = parseUkDateStrict(uk);
    if (!iso) return false;
    if (periodStartIso && iso < periodStartIso) return true;
    if (periodEndIso   && iso > periodEndIso)   return true;
    return false;
  }
  const outOfPeriodRows = derivedRows.filter(r => isOutOfPeriod(r.date));

  /** Right-click row actions on EXISTING entries — same hook the dashboard
   *  uses, so Edit / Duplicate / Change type / Delete / Audit all come
   *  for free. When anything changes we propagate up via
   *  onExistingChanged so the workspace reloads its data and the merged
   *  list refreshes; the user's drafts (local state) survive. */
  const existingRowActions = useTransactionRowActions({
    bookId,
    vatRegistered,
    vatLockDate: vatLockDate ?? null,
    onChanged: () => {
      onExistingChanged?.();
    },
  });

  /** Existing-row IDs that "match what's being typed" — used to subtly
   *  highlight them as a duplicate-prevention cue BEFORE the server's
   *  duplicate-detection step fires. Two heuristics combined:
   *
   *    • Exact amount match between a draft's total and any existing
   *      entry's absolute amount.
   *    • Payee/description prefix match (case-insensitive, >2 chars).
   *
   *  Strict-ish so we don't drown the user in highlights. */
  const matchedExistingIds = useMemo(() => {
    const ids = new Set<string>();
    const entries = existingEntries ?? [];
    for (const d of derivedRows) {
      const payeeLc = d.payee.trim().toLowerCase();
      const hasAmt = d.totalNum > 0.005;
      if (!hasAmt && payeeLc.length <= 2) continue;
      for (const e of entries) {
        const amtMatch = hasAmt && Math.abs(Math.abs(e.signed_amount) - d.totalNum) < 0.005;
        const payeeLcE = (e.payee || '').toLowerCase();
        const payeeMatch = payeeLc.length > 2 && payeeLcE.length > 0 && (
          payeeLcE.startsWith(payeeLc) || payeeLc.startsWith(payeeLcE)
        );
        if (amtMatch || payeeMatch) ids.add(e.split_id);
      }
    }
    return ids;
  }, [derivedRows, existingEntries]);

  // ── Merged display rows (drafts + existing entries, sorted by date) ────
  // We render existing ledger entries inline so the user can spot
  // duplicates as they type and see the running balance update live.
  // Drafts without a valid date sink to the bottom (they're still being
  // entered — don't yank them around as the date is typed character by
  // character).
  type DraftDerived = (typeof derivedRows)[number];
  type DraftDisplayRow   = { kind: 'draft';    draft:    DraftDerived;     sortDate: string; idx: number };
  type ExistingDisplayRow= { kind: 'existing'; existing: ExistingEntry;     sortDate: string };
  type DisplayRow = DraftDisplayRow | ExistingDisplayRow;

  const mergedRows: DisplayRow[] = useMemo(() => {
    const drafts: DisplayRow[] = derivedRows.map((d, idx) => ({
      kind: 'draft' as const,
      draft: d,
      // parseUkDateStrict returns '' or YYYY-MM-DD; '' means undated →
      // sort key is the highest possible string so the row sinks to the
      // bottom of the merged list.
      sortDate: parseUkDateStrict(d.date) || '￿',
      idx,
    }));
    const existing: DisplayRow[] = (existingEntries ?? []).map(e => ({
      kind: 'existing' as const,
      existing: e,
      sortDate: e.date_iso,
    }));
    return [...drafts, ...existing].sort((a, b) => {
      if (a.sortDate !== b.sortDate) return a.sortDate < b.sortDate ? -1 : 1;
      // Same date — DRAFTS render BEFORE existing so click-to-insert
      // (below) reads naturally: clicking an existing row puts the new
      // draft directly above it. Undated drafts still sink to the bottom
      // because their sortDate is '￿'.
      if (a.kind === 'draft' && b.kind === 'existing') return -1;
      if (a.kind === 'existing' && b.kind === 'draft') return 1;
      return 0;
    });
  }, [derivedRows, existingEntries]);

  // ── Click-to-insert handler ────────────────────────────────────────────
  // User clicks an existing ledger row → we drop a new draft above it
  // dated to match. If the last draft is still empty (no payee, no total,
  // no analysis), we re-use it instead of stacking a fresh empty row —
  // saves an extra "blank row at the bottom" the user would have to
  // clean up.
  function insertDraftAtDate(uk: string) {
    const last = rows[rows.length - 1];
    const isEmpty = !!last
      && !last.payee.trim()
      && !last.totalText.trim()
      && !last.analysis
      && !last.entryDetails.trim();
    if (isEmpty) {
      updateRow(last.uid, { date: uk });
      pendingFocusRowId.current = last.uid;
    } else {
      const carryType = last?.type ?? 'PAY';
      const next = makeRow({ type: carryType, date: uk });
      pendingFocusRowId.current = next.uid;
      setRows(prev => [...prev, next]);
    }
  }

  /** Per-row running balance starting from the rec's opening_balance.
   *  Computed by index over the merged list so it follows the sorted
   *  display order, not the order rows were entered. */
  const balanceByRow = useMemo(() => {
    const out: number[] = [];
    let running = openingBalance ?? 0;
    for (const r of mergedRows) {
      if (r.kind === 'existing') {
        running += r.existing.signed_amount;
      } else {
        // Sign by type: PAY/CHQ/TRF = money out (negative); REC = in.
        // We use totalNum (gross) here because the bank-side split is
        // always gross — VAT splits go to VAT accounts.
        const sign = r.draft.type === 'REC' ? 1 : -1;
        running += sign * r.draft.totalNum;
      }
      out.push(Math.round(running * 100) / 100);
    }
    return out;
  }, [mergedRows, openingBalance]);

  const hasExisting = (existingEntries?.length ?? 0) > 0;

  // ── Submit ───────────────────────────────────────────────────────────────
  async function handleSubmit() {
    setError(null);

    // Basic validation that applies to EVERY row — bad dates / negative
    // amounts can't be skipped past; the user has to fix them. Missing
    // analysis account is handled below as a "skip and keep for later"
    // rather than blocking the entire post.
    for (let i = 0; i < derivedRows.length; i++) {
      const r = derivedRows[i];
      if (!r.date)               return setError(`Row ${i + 1}: pick a date.`);
      if (!parseUkDateStrict(r.date))
                                 return setError(`Row ${i + 1}: ${r.date} isn't a real date (dd/mm/yyyy).`);
      if (r.totalNum < 0)        return setError(`Row ${i + 1}: total can't be negative — flip the type instead (PAY ↔ REC).`);
    }

    // Partition: which rows are ready to post (analysis set) and which are
    // missing only the analysis account.  We post the ready ones and KEEP
    // the un-allocated ones in the sheet so the user can finish them
    // after — same modal session, no re-entry required.
    const incompleteIndices: number[] = [];
    let readyCount = 0;
    derivedRows.forEach((r, i) => {
      if (!r.analysis) incompleteIndices.push(i);
      else             readyCount++;
    });
    if (readyCount === 0) {
      return setError('No rows are ready — pick an analysis account on at least one row first.');
    }

    // Soft date-range guard. Out-of-period rows would silently widen the
    // rec on save — fine if intentional, often a typo. Confirm before
    // posting so the user gets one last look. We list up to 5 of the
    // offending rows by number so they can scan for the culprit.
    if (outOfPeriodRows.length > 0 && (periodStartIso || periodEndIso)) {
      const periodLabel = `${periodStartIso ? fromIso(periodStartIso) : '?'} → ${periodEndIso ? fromIso(periodEndIso) : '?'}`;
      const offending = outOfPeriodRows
        .map(r => {
          const idx = derivedRows.findIndex(d => d.uid === r.uid);
          return `Row ${idx + 1}: ${r.date}`;
        })
        .slice(0, 5)
        .join('\n');
      const more = outOfPeriodRows.length > 5 ? `\n…and ${outOfPeriodRows.length - 5} more` : '';
      const ok = confirm(
        `${outOfPeriodRows.length} ${outOfPeriodRows.length === 1 ? 'row falls' : 'rows fall'} outside the rec period (${periodLabel}):\n\n${offending}${more}\n\nPosting will widen the rec period to include ${outOfPeriodRows.length === 1 ? 'it' : 'them'}. Continue?`,
      );
      if (!ok) return;
    }

    // Pass the incomplete-row indices so the server skips them, and tell
    // submitRows to keep them on screen after a successful partial post.
    void submitRows({
      skipRowIndices: incompleteIndices.length > 0 ? incompleteIndices : undefined,
      keepUnpostedOnSuccess: incompleteIndices.length > 0,
    });
  }

  /** Auto-allocate analysis-side accounts for any draft rows that have
   *  enough info (parseable date + amount + payee). Skips rows the user
   *  has already manually filled in (analysis already set) so partial
   *  work isn't blown away. Hits the rule-based allocator endpoint and
   *  applies per-row results. */
  async function handleAutoAllocate() {
    // Build candidate rows from drafts. Skip rows that are empty, undated,
    // or already manually allocated.
    type Candidate = {
      uid: string;
      type: RowType;
      dateIso: string;
      payee: string;
      amount: number;        // signed
    };
    const candidates: Candidate[] = [];
    for (const r of derivedRows) {
      if (r.analysis) continue;                                   // user already set
      const dateIso = parseUkDateStrict(r.date);
      if (!dateIso) continue;                                     // can't allocate without date
      if (r.totalNum <= 0.005) continue;                          // can't allocate zero-amount
      if (!r.payee.trim()) continue;                              // payee is the strongest signal
      const sign = r.type === 'REC' ? 1 : -1;
      candidates.push({
        uid: r.uid,
        type: r.type,
        dateIso,
        payee: r.payee.trim(),
        amount: sign * r.totalNum,
      });
    }
    if (candidates.length === 0) {
      setError('Nothing to auto-allocate — add a date, amount and payee to at least one un-allocated row first.');
      return;
    }

    setAutoAllocating(true);
    setError(null);
    try {
      const res = await fetch(`/api/bookkeeping/books/${bookId}/auto-allocate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          account_id: accountId,
          rows: candidates.map(c => ({
            row_id: c.uid,
            type:   c.type,
            date:   c.dateIso,
            payee:  c.payee,
            amount: c.amount,
          })),
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d.error ?? 'Auto-allocate failed');
        return;
      }
      const data = await res.json() as {
        allocations: Array<{
          row_id: string;
          analysis_account_id: string | null;
          analysis_account_name: string | null;
          analysis_ledger: string | null;
          confidence: 'high' | 'medium' | 'low' | null;
          source: 'supplier_match' | 'customer_match' | 'past_payee' | 'amount_only' | 'ai' | 'unallocated';
          reasoning: string | null;
        }>;
        ai_used?: boolean;
        ai_skipped_reason?: string;
      };
      setAiStatus({ used: !!data.ai_used, reason: data.ai_skipped_reason });

      // Apply results to drafts AND record per-row source/confidence so
      // the indicator column knows what to render.
      const nextIndicators = new Map(allocationByRow);
      const allocById = new Map(data.allocations.map(a => [a.row_id, a]));
      setRows(prev => prev.map(r => {
        const a = allocById.get(r.uid);
        if (!a) return r;
        // Track confidence regardless of whether we set an account.
        nextIndicators.set(r.uid, { confidence: a.confidence, source: a.source, reasoning: a.reasoning });
        if (!a.analysis_account_id) return r;                     // unallocated → leave row blank
        // Derive a plausible account_type from the ledger so AccountPicker
        // doesn't bork — the manual /post route only reads id from this
        // ref anyway, so an inferred type is harmless.
        const acctType: 'asset' | 'liability' | 'income' | 'expense' =
          a.analysis_ledger === 'Customers' ? 'asset'
          : a.analysis_ledger === 'Suppliers' ? 'liability'
          : a.analysis_ledger === 'Income' ? 'income'
          : 'expense';
        return {
          ...r,
          analysisLedger: a.analysis_ledger ?? r.analysisLedger,
          analysis: {
            id:           a.analysis_account_id,
            name:         a.analysis_account_name ?? 'Account',
            ledger:       a.analysis_ledger,
            account_type: acctType,
          },
        };
      }));
      setAllocationByRow(nextIndicators);
    } catch (e) {
      setError(String(e));
    } finally {
      setAutoAllocating(false);
    }
  }

  /** Single submit helper used by initial post + the "skip flagged" /
   *  "post anyway" resubmits from the duplicate review modal. Rows with
   *  no analysis account set are filtered out client-side; if any were
   *  filtered AND keepUnpostedOnSuccess is true, the sheet stays open on
   *  success with just the unposted (incomplete + failed + user-skipped-
   *  dupe-survivors) rows left for the user to finish. */
  async function submitRows(opts: {
    skipRowIndices?: number[];
    confirmDuplicates?: boolean;
    keepUnpostedOnSuccess?: boolean;
  }) {
    setSubmitting(true);
    try {
      // Partition rows: only those with an analysis set can post; the rest
      // are "incomplete" and stay in the sheet when keepUnpostedOnSuccess.
      const ready = derivedRows.filter(r => r.analysis !== null);
      const incomplete = derivedRows.filter(r => r.analysis === null);
      if (ready.length === 0) {
        setError('No rows are ready — pick an analysis account on at least one row first.');
        return;
      }

      const payload: Record<string, unknown> = {
        account_id: accountId,
        ...(existingImportId ? { existing_import_id: existingImportId } : {}),
        ...(opts.skipRowIndices ? { skip_row_indices: opts.skipRowIndices } : {}),
        ...(opts.confirmDuplicates ? { confirm_duplicates: true } : {}),
        rows: ready.map(r => ({
          type: r.type as TransactionType,
          date: parseUkDateStrict(r.date),
          payee_text: r.payee.trim() || null,
          details: r.payee.trim() || null,
          total: r.totalNum,
          vat_total: r.vat,
          vat_rate: r.type === 'TRF' ? null : rateFor(r.vatTreatment) || null,
          vat_treatment: r.vatTreatment,
          analysis_account_id: r.analysis!.id,
          entry_details: r.entryDetails.trim() || null,
        })),
      };
      const res = await fetch(`/api/bookkeeping/books/${bookId}/bank-imports/manual`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 409 && data.error === 'suspected_duplicates' && Array.isArray(data.suspected_duplicates)) {
        setSuspects(data.suspected_duplicates as ManualDupeSuspect[]);
        return;
      }
      if (!res.ok) {
        const failureLines = data.failures && Array.isArray(data.failures)
          ? data.failures.map((f: { row: number; reason: string }) => `Row ${f.row}: ${f.reason}`).join('\n')
          : '';
        setError([data.error ?? 'Manual rec failed', failureLines].filter(Boolean).join('\n'));
        return;
      }

      // ── Partial-post path: keep the sheet open and only remove rows
      // that actually made it into the ledger. Survivors stay on screen:
      //   • incomplete rows (no analysis picked — never sent)
      //   • rows whose post failed server-side (in data.failures)
      const failedSendIndices = new Set((data.failures ?? []).map((f: { row: number }) => f.row - 1));
      const userSkippedSendIndices = new Set(opts.skipRowIndices ?? []);
      if (opts.keepUnpostedOnSuccess && incomplete.length > 0) {
        const survivingUids = new Set<string>();
        ready.forEach((r, i) => {
          // Survive only if the server reported a failure AND the user
          // didn't explicitly choose to skip it (user-skipped dupes are
          // dropped — that was the user's intent).
          if (failedSendIndices.has(i) && !userSkippedSendIndices.has(i)) {
            survivingUids.add(r.uid);
          }
        });
        for (const r of incomplete) survivingUids.add(r.uid);
        setRows(prev => prev.filter(rr => survivingUids.has(rr.uid)));
        // Clear allocation indicators for rows that just left the sheet.
        setAllocationByRow(prev => {
          const next = new Map(prev);
          for (const r of derivedRows) if (!survivingUids.has(r.uid)) next.delete(r.uid);
          return next;
        });
        // Notify parent so the workspace's existingEntries list refreshes
        // with the newly-posted rows (and the cleared total + gap update).
        onExistingChanged?.();
        setError(null);
        // Brief feedback on what happened.
        const postedCount = ready.length - failedSendIndices.size - userSkippedSendIndices.size;
        if (data.failures && data.failures.length > 0) {
          const failureLines = data.failures
            .map((f: { row: number; reason: string }) => `Row ${f.row}: ${f.reason}`)
            .join('\n');
          alert(`Posted ${postedCount} rows. ${data.failures.length} failed:\n${failureLines}\n\n${incomplete.length} row(s) still need an analysis account.`);
        }
        return;
      }

      // ── Full-post path: every draft posted, close the modal.
      if (data.failures && data.failures.length > 0) {
        const failureLines = data.failures
          .map((f: { row: number; reason: string }) => `Row ${f.row}: ${f.reason}`)
          .join('\n');
        alert(`Posted ${data.posted_rows} rows. ${data.failures.length} row(s) failed:\n${failureLines}`);
      }
      onPosted(data.import_id);
    } catch (e) {
      setError(String(e));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    // Renders as a full workspace page (no modal), opened as a dynamic tab
    // in BookSideRail. Mirrors UniversalInputSheet's lifecycle so the user
    // never loses their place — they can hop to another tab, come back, and
    // pick up where they were.
    <div
      ref={modalRef}
      className="bg-white rounded-xl border border-slate-200 shadow-sm flex flex-col w-full"
      // When opened inside a modal the parent fixes a height; otherwise
      // (rail-tab use case) fall back to a calc that leaves room for the
      // SMITH chrome above. The modal wrapper sets height on its inner
      // container, so this fallback only takes effect when used standalone.
      style={{ height: existingImportId ? '100%' : 'calc(100vh - 14rem)' }}
    >
        {/* Header */}
        <div className="px-5 py-3 border-b border-slate-200 flex items-center gap-3 shrink-0">
          <Pencil size={16} className="text-indigo-600" />
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
              Manual reconciliation — {accountName}
              {(periodStartIso || periodEndIso) && (
                <span className="text-[11px] font-normal text-slate-500">
                  · period {periodStartIso ? fromIso(periodStartIso) : '?'} → {periodEndIso ? fromIso(periodEndIso) : '?'}
                </span>
              )}
              {outOfPeriodRows.length > 0 && (
                <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wide font-semibold px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200">
                  <AlertCircle size={9} /> {outOfPeriodRows.length} outside period
                </span>
              )}
            </h2>
            <p className="text-[11px] text-slate-500">
              Enter each statement line below. Press <kbd className="px-1 py-0.5 rounded bg-slate-100 text-slate-700 text-[10px] font-mono">P</kbd>/<kbd className="px-1 py-0.5 rounded bg-slate-100 text-slate-700 text-[10px] font-mono">R</kbd>/<kbd className="px-1 py-0.5 rounded bg-slate-100 text-slate-700 text-[10px] font-mono">C</kbd>/<kbd className="px-1 py-0.5 rounded bg-slate-100 text-slate-700 text-[10px] font-mono">T</kbd> in TYPE to flip between PAY / REC / CHQ / TRF. Tab off the last cell to add a new row.
            </p>
          </div>
          <button onClick={onClose} aria-label="Close" className="text-slate-400 hover:text-slate-700 shrink-0">
            <X size={16} />
          </button>
        </div>

        {error && (
          <div className="px-5 py-2 bg-rose-50 border-b border-rose-200 text-rose-800 text-xs flex items-start gap-2 shrink-0">
            <AlertCircle size={12} className="mt-0.5 shrink-0" />
            <pre className="whitespace-pre-wrap font-sans">{error}</pre>
            <button onClick={() => setError(null)} className="ml-auto text-rose-600 hover:text-rose-800 shrink-0"><X size={11} /></button>
          </div>
        )}

        {/* Sheet — Excel-style grid matching UniversalInputSheet's borders + cell layout */}
        <div className="flex-1 overflow-auto">
          <table className="w-full text-sm border-collapse">
            <thead className="bg-slate-50 text-[10px] uppercase tracking-wide font-semibold text-slate-500 sticky top-0 z-10">
              <tr>
                <th className="px-2 py-2 text-left w-8 border-r border-slate-200">#</th>
                <th className="px-2 py-2 text-left w-20 border-r border-slate-200">Type</th>
                <th className="px-2 py-2 text-left w-44 border-r border-slate-200">Date</th>
                <th className="px-2 py-2 text-left border-r border-slate-200">Details (payee)</th>
                <th className="px-2 py-2 text-right w-28 border-r border-slate-200">Total</th>
                {showVatColumn && <th className="px-2 py-2 text-left w-32 border-r border-slate-200">VAT</th>}
                {showVatColumn && <th className="px-2 py-2 text-right w-24 border-r border-slate-200">Net</th>}
                <th className="px-2 py-2 text-left w-32 border-r border-slate-200">Ledger</th>
                <th className="px-2 py-2 text-left w-40 border-r border-slate-200">Analysis account</th>
                <th className="px-2 py-2 text-left">Entry details</th>
                {hasExisting && <th className="px-2 py-2 text-right w-28 border-l border-slate-200">Balance</th>}
                <th className="px-1 py-2 w-8" />
              </tr>
            </thead>
            <tbody>
              {/* Opening balance pseudo-row — anchors the running balance
                  column so the user can see where the walk starts. Only
                  shown when we're rendering existing entries inline. */}
              {hasExisting && (
                <tr className="bg-slate-50/60 text-[11px] text-slate-500">
                  <td colSpan={showVatColumn ? 9 : 7} className="px-2 py-1 italic">
                    Opening balance
                  </td>
                  <td className="px-2 py-1" />
                  <td className="px-2 py-1 text-right tabular-nums font-semibold text-slate-700 border-l border-slate-200">
                    {(openingBalance ?? 0).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </td>
                  <td />
                </tr>
              )}

              {(() => {
                // Walk the merged list once, inserting:
                //   • a date-subheader pseudo-row whenever the sortDate
                //     changes from the row above (skip the '￿' bucket so
                //     undated drafts at the bottom don't earn a header)
                //   • ExistingDisplayRow for existing-entry rows
                //   • inline draft <tr> for draft rows (kept inline rather
                //     than extracted to a helper because it closes over
                //     a lot of component state)
                const nodes: React.ReactNode[] = [];
                let prevDate = '';
                mergedRows.forEach((mr, mergedIdx) => {
                  const isReal = mr.sortDate && mr.sortDate !== '￿';
                  if (isReal && mr.sortDate !== prevDate) {
                    nodes.push(
                      <tr key={`hdr-${mr.sortDate}`} className="bg-slate-100/70">
                        <td colSpan={showVatColumn ? 11 : 9} className="px-3 py-1 text-[10px] uppercase tracking-wide font-semibold text-slate-500">
                          {fromIso(mr.sortDate)}
                        </td>
                        <td />
                      </tr>,
                    );
                    prevDate = mr.sortDate;
                  }
                  if (mr.kind === 'existing') {
                    nodes.push(
                      <ExistingDisplayRow
                        key={`x-${mr.existing.split_id}`}
                        entry={mr.existing}
                        balance={balanceByRow[mergedIdx]}
                        showVatColumn={showVatColumn}
                        isMatched={matchedExistingIds.has(mr.existing.split_id)}
                        contextProps={existingRowActions.rowProps}
                        onInsertHere={() => insertDraftAtDate(fromIso(mr.existing.date_iso))}
                      />,
                    );
                    return;
                  }
                  // Draft row — inline JSX (closes over rows, updateRow,
                  // removeRow, derivedRows, hasExisting, balanceByRow, etc.).
                  const r = mr.draft;
                  const i = mr.idx;
                  const tone = TYPE_TONES[r.type];
                  const isLastRow = i === derivedRows.length - 1;
                  nodes.push(
                    <tr key={r.uid} className={`border-b border-slate-100 ${tone.row} group/row text-[12px] [&_input]:text-[12px] [&_select]:text-[12px] [&_button]:text-[12px]`}>
                      {/* # — hover reveals delete */}
                      <td className="px-2 py-0 text-slate-400 tabular-nums text-center border-r border-slate-200 relative">
                        <span className="group-hover/row:opacity-0">{i + 1}</span>
                        {rows.length > 1 && (
                          <button
                            type="button"
                            onClick={() => removeRow(r.uid)}
                            aria-label="Delete row"
                            className="absolute inset-0 m-auto w-5 h-5 rounded text-rose-600 hover:bg-rose-100 opacity-0 group-hover/row:opacity-100 flex items-center justify-center transition-opacity"
                          >
                            <Trash2 size={11} />
                          </button>
                        )}
                      </td>
                      {/* TYPE */}
                      <td className="px-1 py-0 border-r border-slate-200">
                        <select
                          ref={el => { typeRefs.current.set(r.uid, el); }}
                          value={r.type}
                          onChange={e => changeType(r.uid, e.target.value as RowType)}
                          onKeyDown={e => onTypeKeyDown(r.uid, e)}
                          className={`w-full px-1.5 py-1.5 border-0 bg-transparent focus:outline-none focus:ring-2 focus:ring-inset focus:ring-indigo-500 font-mono font-semibold ${tone.selectText}`}
                          aria-label={`Row ${i + 1} type`}
                        >
                          <option value="PAY">PAY</option>
                          <option value="CHQ">CHQ</option>
                          <option value="REC">REC</option>
                          <option value="TRF">TRF</option>
                        </select>
                      </td>
                      {/* Date — flex layout keeps the date input and the
                          out-of-period warning icon side-by-side at the
                          same baseline. Previously the icon was absolute-
                          positioned which clipped the date string and
                          made adjacent rows look misaligned. */}
                      <td className={`px-1 py-0 border-r border-slate-200 ${
                        isOutOfPeriod(r.date) ? 'bg-amber-50' : ''
                      }`}>
                        <div className="flex items-center gap-1">
                          <div className="flex-1 min-w-0">
                            <DateInput
                              value={r.date}
                              onChange={v => updateRow(r.uid, { date: v })}
                              previousDate={i > 0 ? derivedRows[i - 1].date : undefined}
                              // 12px to match the existing-row read-only
                              // font — keeps "dd/mm/yyyy" inside the cell
                              // when the calendar + warning icons are
                              // both present.
                              className="!text-[12px]"
                            />
                          </div>
                          {isOutOfPeriod(r.date) && (
                            <Tooltip label={`Outside the rec period (${periodStartIso ? fromIso(periodStartIso) : '?'} → ${periodEndIso ? fromIso(periodEndIso) : '?'})`}>
                              <span aria-hidden className="text-amber-600 shrink-0 mr-1">
                                <AlertCircle size={11} />
                              </span>
                            </Tooltip>
                          )}
                        </div>
                      </td>
                      {/* Payee */}
                      <td className="px-1 py-0 border-r border-slate-200">
                        <PayeeAutocomplete
                          bookId={bookId}
                          type={r.type}
                          value={r.payee}
                          onChange={v => updateRow(r.uid, { payee: v })}
                          onSelectPayee={p => {
                            updateRow(r.uid, {
                              payee: p.payee_display,
                              vatTreatment: p.vat_treatment ?? r.vatTreatment,
                              analysisLedger: p.analysis_account?.ledger ?? r.analysisLedger,
                              analysis: p.analysis_account
                                ? { ...p.analysis_account, account_type: r.analysis?.account_type ?? 'expense' as const }
                                : r.analysis,
                              entryDetails: p.entry_details ?? r.entryDetails,
                            });
                          }}
                          placeholder={r.type === 'TRF' ? 'Transfer description' : 'Payee / description'}
                        />
                      </td>
                      {/* Total */}
                      <td className="px-0 py-0 border-r border-slate-200">
                        <input
                          type="text"
                          inputMode="decimal"
                          value={r.totalText}
                          onChange={e => updateRow(r.uid, { totalText: e.target.value })}
                          placeholder="0.00"
                          className="w-full !text-sm px-2 py-1.5 border-0 bg-transparent text-right focus:outline-none focus:ring-2 focus:ring-inset focus:ring-indigo-500 tabular-nums"
                        />
                      </td>
                      {/* VAT */}
                      {showVatColumn && (
                        <td className="px-1 py-0 border-r border-slate-200">
                          {r.type === 'TRF' ? (
                            <span className="text-xs text-slate-400 italic px-2">n/a</span>
                          ) : (
                            <VatTreatmentPicker
                              value={r.vatTreatment}
                              onChange={v => updateRow(r.uid, { vatTreatment: v })}
                              className="!border-none"
                            />
                          )}
                        </td>
                      )}
                      {/* Net */}
                      {showVatColumn && (
                        <td className="px-0 py-0 border-r border-slate-200">
                          <div className="text-sm px-2 py-1.5 text-right text-slate-600 tabular-nums">
                            {r.totalNum > 0 ? r.net.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : ''}
                          </div>
                        </td>
                      )}
                      {/* Ledger */}
                      <td className="px-1 py-0 border-r border-slate-200">
                        <LedgerPicker
                          value={r.analysisLedger}
                          onChange={newLedger => updateRow(r.uid, {
                            analysisLedger: newLedger,
                            analysis: r.analysis && r.analysis.ledger === newLedger ? r.analysis : null,
                          })}
                          placeholder="Ledger…"
                          className="!border-none"
                        />
                      </td>
                      {/* Analysis + auto-allocate confidence indicator.
                          Flex layout so the indicator icon sits inline
                          next to the AccountPicker rather than absolutely
                          positioned — Tooltip wraps the icon in its own
                          `relative` span which broke our previous
                          absolute anchoring. */}
                      <td className={`px-1 py-0 border-r border-slate-200 ${
                        (() => {
                          const a = allocationByRow.get(r.uid);
                          if (!a) return '';
                          if (a.confidence === 'high')   return 'bg-emerald-50/50';
                          if (a.confidence === 'medium') return 'bg-amber-50/40';
                          if (a.confidence === 'low')    return 'bg-amber-50/60';
                          if (a.source === 'unallocated') return 'bg-rose-50/30';
                          return '';
                        })()
                      }`}>
                        <div className="flex items-center gap-1">
                          <div className="flex-1 min-w-0">
                            <AccountPicker
                              bookId={bookId}
                              value={r.analysis?.id ?? null}
                              valueDisplay={r.analysis ? r.analysis.name : undefined}
                              onChange={a => updateRow(r.uid, {
                                analysis: a,
                                analysisLedger: a?.ledger ?? r.analysisLedger,
                              })}
                              ledgerFilter={r.analysisLedger || undefined}
                              disabled={!r.analysisLedger}
                              placeholder={r.analysisLedger ? 'Account…' : 'Pick ledger first'}
                              className="!border-none"
                            />
                          </div>
                          {(() => {
                            const a = allocationByRow.get(r.uid);
                            if (!a) return null;
                            if (a.source === 'unallocated') {
                              return (
                                <Tooltip label={a.reasoning ?? 'Auto-allocate couldn’t find a match — pick an account manually'}>
                                  <span aria-hidden className="text-rose-600 shrink-0 mr-1">
                                    <HelpCircle size={11} />
                                  </span>
                                </Tooltip>
                              );
                            }
                            const isAi = a.source === 'ai';
                            // AI suggestions get the Bot icon in indigo so
                            // the user can tell at a glance which rows the
                            // model picked vs which were rule-decided.
                            const Icon = isAi ? Bot : Sparkles;
                            const colour = isAi
                              ? (a.confidence === 'high' ? 'text-indigo-600'
                                : a.confidence === 'medium' ? 'text-indigo-500'
                                : 'text-indigo-400')
                              : a.confidence === 'high'   ? 'text-emerald-600'
                              : a.confidence === 'medium' ? 'text-amber-600'
                              :                              'text-amber-500';
                            const label = a.reasoning
                              ? `${isAi ? 'AI · ' : ''}${a.reasoning}`
                              : `${a.source.replace('_', ' ')} (${a.confidence ?? 'unknown'})`;
                            return (
                              <Tooltip label={label}>
                                <span aria-hidden className={`${colour} shrink-0 mr-1`}>
                                  <Icon size={11} />
                                </span>
                              </Tooltip>
                            );
                          })()}
                        </div>
                      </td>
                      {/* Entry details */}
                      <td className="px-0 py-0">
                        <input
                          type="text"
                          value={r.entryDetails}
                          onChange={e => updateRow(r.uid, { entryDetails: e.target.value })}
                          onKeyDown={e => {
                            if (e.key === 'Tab' && !e.shiftKey && isLastRow) {
                              if (isRowReadyForNext(r)) {
                                e.preventDefault();
                                appendRow();
                              }
                            }
                          }}
                          placeholder="Entry note"
                          className="w-full !text-sm px-2 py-1.5 border-0 bg-transparent focus:outline-none focus:ring-2 focus:ring-inset focus:ring-indigo-500"
                        />
                      </td>
                      {/* Balance — kept at text-sm to match the running
                          balance in the opening-balance / footer rows. */}
                      {hasExisting && (
                        <td className="px-2 py-1 text-sm text-right tabular-nums font-semibold text-slate-900 border-l border-slate-200">
                          {r.totalNum > 0 || parseUkDateStrict(r.date)
                            ? balanceByRow[mergedIdx].toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                            : <span className="text-slate-300">—</span>}
                        </td>
                      )}
                      {/* Spacer */}
                      <td className="px-0 py-0" />
                    </tr>,
                  );
                });
                return nodes;
              })()}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-slate-300 bg-slate-50">
                <td colSpan={4} className="px-2 py-2 text-[10px] uppercase tracking-wide font-semibold text-slate-500">
                  {rows.length} new {rows.length === 1 ? 'row' : 'rows'}
                  {hasExisting && (
                    <span className="ml-1 text-slate-400 font-normal normal-case">
                      · {existingEntries?.length ?? 0} existing shown
                    </span>
                  )}
                </td>
                <td className="px-2 py-2 text-right tabular-nums font-bold text-slate-900">
                  {grandTotal.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </td>
                <td colSpan={showVatColumn ? 5 : 3} />
                {/* Closing balance after every row has posted — the final
                    running balance. Helps the user mentally check against
                    the statement closing figure. */}
                {hasExisting && (
                  <td className="px-2 py-2 text-right tabular-nums font-bold text-slate-900 border-l border-slate-200">
                    {(balanceByRow[balanceByRow.length - 1] ?? (openingBalance ?? 0)).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </td>
                )}
                <td />
              </tr>
            </tfoot>
          </table>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-slate-200 flex items-center gap-2 bg-slate-50/40 shrink-0">
          <button
            type="button"
            onClick={() => appendRow()}
            disabled={submitting || !lastRowReady()}
            title={lastRowReady() ? 'Add a new row' : 'Pick VAT, ledger and an analysis account on the current row first.'}
            className="inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-md border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Plus size={11} /> Add row
          </button>
          {/* Auto-allocate — runs the rule-based allocator (supplier/customer
              open balance, then past-payee most-recent-wins). Fills in the
              Ledger + Analysis cells on un-allocated rows. */}
          <button
            type="button"
            onClick={() => void handleAutoAllocate()}
            disabled={submitting || autoAllocating}
            title="Try to auto-fill the Ledger + Analysis on rows that have a date, payee and amount."
            className="inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-md border border-violet-200 bg-violet-50 hover:bg-violet-100 text-violet-800 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {autoAllocating
              ? <><Loader2 size={11} className="animate-spin" /> Allocating…</>
              : <><Sparkles size={11} /> Auto-allocate accounts</>}
          </button>
          {/* AI status pill — surfaced after a run so the user knows
              whether the model was used, skipped, or wasn't needed. */}
          {aiStatus && !autoAllocating && (() => {
            if (aiStatus.used) {
              return (
                <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wide font-semibold px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700 border border-indigo-200">
                  <Bot size={9} /> AI assisted
                </span>
              );
            }
            if (aiStatus.reason === 'all_high_confidence') {
              return (
                <span className="text-[10px] text-emerald-700">Rules handled everything · AI not needed</span>
              );
            }
            if (aiStatus.reason === 'no_api_key') {
              return (
                <Tooltip label="Add an Anthropic API key in Settings → AI to let AI fill in the rows the rules couldn't.">
                  <span className="text-[10px] text-slate-500 italic underline decoration-dotted underline-offset-2">
                    AI fallback skipped (no key)
                  </span>
                </Tooltip>
              );
            }
            return null;
          })()}
          <span className="text-[11px] text-slate-500 ml-2">
            Tip: Tab off the last cell to add a new row.
            {!lastRowReady() && <span className="text-amber-700"> · Finish the current row first (VAT, ledger, analysis account).</span>}
          </span>
          <button onClick={onClose} disabled={submitting} className="ml-auto text-xs px-3 py-1.5 text-slate-600 hover:text-slate-900">
            Cancel
          </button>
          {(() => {
            // Partition by readiness for the button label. A row is "ready"
            // when the user (or the auto-allocator) has set an analysis
            // account; anything missing one will stay in the sheet after
            // a partial post so the user can finish it later.
            const readyCount = derivedRows.filter(r => r.analysis !== null).length;
            const incompleteCount = rows.length - readyCount;
            const label = incompleteCount > 0
              ? `Post ${readyCount} completed ${readyCount === 1 ? 'row' : 'rows'}`
              : `Post & reconcile ${readyCount} ${readyCount === 1 ? 'row' : 'rows'}`;
            const tooltip = incompleteCount > 0
              ? `${readyCount} row${readyCount === 1 ? '' : 's'} will post. ${incompleteCount} unallocated row${incompleteCount === 1 ? '' : 's'} will stay in the sheet for you to finish.`
              : undefined;
            return (
              <button
                onClick={handleSubmit}
                disabled={submitting || readyCount === 0}
                title={tooltip}
                className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded bg-indigo-600 hover:bg-indigo-700 text-white disabled:opacity-50"
              >
                {submitting
                  ? <><Loader2 size={11} className="animate-spin" /> Posting…</>
                  : <><Check size={11} /> {label}</>}
              </button>
            );
          })()}
        </div>

        {/* Duplicate review — appears when the server's dupe scan flags any
            rows. Skip drops those rows from the resubmit; Add anyway sets
            confirm_duplicates so the server skips the scan. */}
        {suspects && (
          <DuplicateReviewModal
            totalCount={rows.length}
            busy={submitting}
            suspects={suspects.map<DupeSuspect>(s => {
              // Server returns total as positive; sign by type to mirror
              // the bank-side direction the dupe scan used.
              const sign = (s.row.type === 'REC') ? 1 : -1;
              return {
                index: s.row_index,
                candidateDate:  s.row.date,
                candidateAmount: sign * s.row.total,
                candidateLabel: s.row.payee_text ?? `${s.row.type} (no description)`,
                matchRef:          s.match.ref_no,
                matchDate:         s.match.date,
                matchSignedAmount: s.match.signed_amount,
                matchDetails:      s.match.details,
              };
            })}
            onClose={() => setSuspects(null)}
            onSkip={(indices) => {
              setSuspects(null);
              void submitRows({ skipRowIndices: indices });
            }}
            onConfirmAll={() => {
              setSuspects(null);
              void submitRows({ confirmDuplicates: true });
            }}
          />
        )}

        {/* Right-click action menus for EXISTING entries (Edit / Duplicate
            / Change type / Audit / Delete). Mounted at sheet root so the
            modals it portals to body don't get clipped by the table's
            overflow container. */}
        {existingRowActions.menus}
    </div>
  );
}

// ── Existing-entry row ─────────────────────────────────────────────────────
// Muted read-only row rendered inline with the draft rows so the user can
// see the live ledger context as they type. Cleared rows get a soft
// emerald tint; uncleared sit on plain slate so they're easy to tell apart
// at a glance. The Balance cell shares the same column the draft rows do.
//
// Clicking the row drops a new draft above it dated to match (or reuses
// the last empty draft if one exists). The user can then type the new
// statement line in chronological position without having to manually
// enter the date.
function ExistingDisplayRow({
  entry, balance, showVatColumn, onInsertHere, isMatched, contextProps,
}: {
  entry: ExistingEntry;
  balance: number;
  showVatColumn: boolean;
  onInsertHere?: () => void;
  /** True when this row matches what's currently being typed in a draft
   *  (by amount or payee prefix). Visually nudges the user toward
   *  potential duplicates before the server's dupe-detection step. */
  isMatched?: boolean;
  /** Right-click context-menu wiring from useTransactionRowActions. Spread
   *  to attach `onContextMenu` (and the `group` class for hover-action
   *  reveals later if we choose). */
  contextProps?: (t: Transaction) => { className: string; onContextMenu: (e: React.MouseEvent) => void };
}) {
  const isMoneyOut = entry.signed_amount < 0;
  const baseRow = entry.cleared
    ? 'bg-emerald-50/40 hover:bg-emerald-50'
    : 'bg-slate-50/40 hover:bg-slate-100/60';
  const muted = 'text-slate-500';

  // Minimal Transaction-shaped seed for the actions hook — the Edit modal
  // re-fetches the full transaction by id on mount, so a partial is fine.
  const txnSeed: Transaction = {
    id: entry.transaction_id,
    book_id: '',
    type: (entry.type || 'PAY') as TxType,
    ref_no: entry.ref_no,
    ref_seq: 0,
    date: entry.date_iso,
    payee_text: entry.payee || null,
    details: null,
    total: 0,
    vat_total: entry.vat_total ?? 0,
    vat_rate: null,
    vat_treatment: null,
    vat_period_override: null,
    primary_account_id: null,
    status: 'posted',
    created_by: null,
    created_at: '',
    updated_at: '',
    posted_at: null,
  } as Transaction;
  const ctxBindings = contextProps?.(txnSeed);

  // Match-hint visual: thicker left border + slightly stronger bg so the
  // row stands out without screaming. Only applied when isMatched is true.
  const matchRing = isMatched ? 'shadow-[inset_3px_0_0_0_rgb(124_58_237)] bg-violet-50/60' : '';

  return (
    <tr
      className={`border-b border-slate-100 ${baseRow} ${matchRing} ${onInsertHere ? 'cursor-pointer' : ''} ${ctxBindings?.className ?? ''}`}
      onClick={(e) => {
        // Don't fire click-to-insert on a ctrl+click — that's the Mac
        // right-click gesture; the context menu should take precedence.
        if (e.ctrlKey || e.metaKey) return;
        onInsertHere?.();
      }}
      onContextMenu={ctxBindings?.onContextMenu}
      title={onInsertHere ? 'Click to insert a new line above this row at the same date — right-click for Edit / Delete' : undefined}
    >
      {/* # — cleared tick or blank */}
      <td className="px-2 py-1 text-center border-r border-slate-200">
        {entry.cleared
          ? <Check size={11} className="text-emerald-600 inline-block" />
          : <span className="text-slate-300">·</span>}
      </td>
      {/* TYPE */}
      <td className={`px-2 py-1 text-[11px] font-mono uppercase ${muted} border-r border-slate-200`}>
        {entry.type}
      </td>
      {/* DATE */}
      <td className={`px-2 py-1 text-[12px] tabular-nums ${muted} border-r border-slate-200`}>
        {fromIso(entry.date_iso)}
      </td>
      {/* DETAILS — ref + payee/desc */}
      <td className={`px-2 py-1 text-[12px] truncate max-w-[280px] ${muted} border-r border-slate-200`}>
        <span className="text-indigo-500 mr-1">{entry.ref_no}</span>
        <span>{entry.payee || ''}</span>
      </td>
      {/* TOTAL (absolute, signed-coloured) */}
      <td className={`px-2 py-1 text-right tabular-nums ${isMoneyOut ? 'text-rose-500' : 'text-emerald-600'} border-r border-slate-200`}>
        {Math.abs(entry.signed_amount).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
      </td>
      {/* VAT — blank (we don't know the treatment without re-fetching) */}
      {showVatColumn && <td className="border-r border-slate-200" />}
      {/* Net — derive from gross − vat_total on the transaction */}
      {showVatColumn && (
        <td className={`px-2 py-1 text-right tabular-nums ${muted} border-r border-slate-200`}>
          {(() => {
            const net = Math.max(0, Math.abs(entry.signed_amount) - (entry.vat_total ?? 0));
            return net.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
          })()}
        </td>
      )}
      {/* LEDGER — the analysis-side ledger (Expenses / Income / …) */}
      <td className={`px-2 py-1 text-[12px] truncate max-w-[140px] ${muted} border-r border-slate-200`}>
        {entry.analysis_ledger ?? ''}
      </td>
      {/* ANALYSIS ACCOUNT — what the OTHER leg posts to */}
      <td className={`px-2 py-1 text-[12px] truncate max-w-[180px] ${muted} border-r border-slate-200`}>
        {entry.analysis_account_name ?? ''}
      </td>
      {/* Entry details — blank */}
      <td />
      {/* Balance — always full-strength + text-sm so the running balance
          column reads consistently against the draft rows + footer. */}
      <td className="px-2 py-1 text-sm text-right tabular-nums font-semibold text-slate-800 border-l border-slate-200">
        {balance.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
      </td>
      <td />
    </tr>
  );
}
