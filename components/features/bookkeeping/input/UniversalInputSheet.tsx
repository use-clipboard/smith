'use client';

/**
 * UniversalInputSheet — VT-style keyboard-first transaction entry grid.
 *
 * Multi-row Excel-style sheet for the 8 header-plus-analysis transaction
 * types (PAY, CHQ, REC, TRF, SIN, SCR, PIN, PCR). Each row is its own
 * posted transaction; "Post" batches the lot.
 *
 * Behaviour mirrors JournalInputSheet so users only learn one input model:
 *   - Inline toolbar above the grid: Insert row · Delete row · Delete all
 *     rows · Clear all amounts.
 *   - Hover the # column to reveal a per-row trash icon.
 *   - Tab off the final (Entry-details) cell of the final row appends a
 *     new line and drops focus into it — bulk entry without the mouse.
 *   - Single Post button at the bottom commits every non-blank row.
 *   - Ledger is picked first; the Analysis-Account picker filters by it.
 *   - VAT auto-calculates per row from Total + treatment; non-VAT books
 *     hide the VAT/Net columns entirely.
 *   - F9 / Ctrl+F9 clone the most recent transaction of this type into a
 *     newly-appended row.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Loader2, Trash2 } from 'lucide-react';
import AccountPicker from './AccountPicker';
import LedgerPicker from './LedgerPicker';
import DateInput, { parseUkDateStrict } from './DateInput';
import PayeeAutocomplete, { type PayeeSuggestion } from './PayeeAutocomplete';
import { useTransactionRowActions } from '../transactions/useTransactionRowActions';
import { TxnRefLink, AccountLink } from '../book/BookNavigationContext';
import { formatMoneyAbs } from '@/lib/bookkeeping/formatMoney';
import {
  VAT_TREATMENT_OPTIONS,
  type BookAccountRef, type Transaction, type TransactionType, type VatTreatment,
} from '@/types/bookkeeping';
import { getTypeConfig, TRANSACTION_TYPE_CONFIG } from '@/lib/bookkeeping/transactionTypeConfig';
import { buildSplits } from '@/lib/bookkeeping/buildSplits';
import { checkRecLock, type RecLockHit, type RecLockProbe } from '@/lib/bookkeeping/checkRecLock';
import RecLockWarningModal from '../ledger/RecLockWarningModal';

interface Props {
  bookId: string;
  vatRegistered: boolean;
  /** Soft VAT lock — transactions dated on/before this need to be flagged as
   *  late entries (vat_period_override set server-side). The next VAT return
   *  then picks them up. */
  vatLockDate?: string | null;
  type: TransactionType;
  onTypeChange: (t: TransactionType) => void;
  onPosted?: (txn: Transaction) => void;
  /** ISO date new rows should default to — the end of the currently-selected
   *  accounting period. Falls back to today when not provided (no year set). */
  defaultDateIso?: string | null;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function todayIso(): string { return new Date().toISOString().slice(0, 10); }
// Strict parser shared with DateInput — returns '' if the date isn't real
// (e.g. 20/20/2025 → '', 30/02/2025 → ''). The component-level error message
// surfaces the row number when validation fails.
const parseDate = parseUkDateStrict;
function formatDateUk(iso: string): string {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  if (!y || !m || !d) return iso;
  return `${d}/${m}/${y}`;
}
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

// ── Row state ────────────────────────────────────────────────────────────────

interface Row {
  id: string;                  // local-only React key
  date: string;
  primary: BookAccountRef | null;
  details: string;
  totalText: string;
  vatTreatment: VatTreatment;
  /** Analysis ledger — picked first; the account picker filters by it. */
  analysisLedger: string;
  analysis: BookAccountRef | null;
  entryDetails: string;
  notes: string;
  /** User intent on a late-entry row: include this transaction's VAT in the
   *  next return. Default true on rows where the date falls in the VAT lock.
   *  User can untick to force a hard rejection (the server will reply 409). */
  includeInNextReturn: boolean;
}

function makeBlankRow(vatRegistered: boolean, analysisLedger: string, seed: Partial<Row> = {}, defaultDateUk?: string): Row {
  return {
    id: Math.random().toString(36).slice(2),
    date: seed.date ?? defaultDateUk ?? formatDateUk(todayIso()),
    primary: seed.primary ?? null,
    details: '',
    totalText: '',
    vatTreatment: seed.vatTreatment ?? (vatRegistered ? 'standard_20' : 'no_vat'),
    analysisLedger: seed.analysisLedger ?? analysisLedger,
    analysis: null,
    entryDetails: '',
    notes: '',
    includeInNextReturn: true,  // default ticked; ignored unless row triggers late-entry
  };
}

/** True if this row's date falls in a filed VAT period AND the row carries VAT.
 *  Drives the amber ring on the date cell + the late-entry summary panel. */
function isLateEntry(row: Row, vatLockDate: string | null | undefined, rate: number): boolean {
  if (!vatLockDate) return false;
  if (rate <= 0) return false;
  const iso = parseUkDateStrict(row.date);
  if (!iso) return false;
  return iso <= vatLockDate;
}

// Type selector — ordered to match the action-toolbar grouping.
const TYPE_ORDER: TransactionType[] = ['PAY','CHQ','REC','TRF','SIN','SCR','PIN','PCR','JRN','RJN','YET','DVT','WOF','WBK'];

// Per-family colour tints — match the New transaction popout's icon tiles.
const FAMILY_PILL_CLASSES: Record<'bank'|'sales'|'purchases'|'journals'|'adjustments', { active: string; inactive: string }> = {
  bank:        { active: 'bg-emerald-600 text-white', inactive: 'text-slate-600 hover:bg-emerald-50 hover:text-emerald-700' },
  sales:       { active: 'bg-blue-600 text-white',    inactive: 'text-slate-600 hover:bg-blue-50 hover:text-blue-700'      },
  purchases:   { active: 'bg-amber-600 text-white',   inactive: 'text-slate-600 hover:bg-amber-50 hover:text-amber-700'    },
  journals:    { active: 'bg-violet-600 text-white',  inactive: 'text-slate-600 hover:bg-violet-50 hover:text-violet-700'  },
  adjustments: { active: 'bg-rose-600 text-white',    inactive: 'text-slate-600 hover:bg-rose-50 hover:text-rose-700'      },
};
function familyOf(t: TransactionType): keyof typeof FAMILY_PILL_CLASSES {
  if (t === 'PAY' || t === 'CHQ' || t === 'REC' || t === 'TRF') return 'bank';
  if (t === 'SIN' || t === 'SCR') return 'sales';
  if (t === 'PIN' || t === 'PCR') return 'purchases';
  if (t === 'WOF' || t === 'WBK') return 'adjustments';
  return 'journals'; // JRN, RJN, YET, DVT
}

// ── Component ────────────────────────────────────────────────────────────────

export default function UniversalInputSheet({
  bookId, vatRegistered, vatLockDate, type, onTypeChange, onPosted, defaultDateIso,
}: Props) {
  const config = getTypeConfig(type) ?? TRANSACTION_TYPE_CONFIG.PAY;
  // New rows default their date to the end of the currently-selected accounting
  // period (passed from BookView); today only when no year is set up.
  const defaultDateUk = defaultDateIso ? formatDateUk(defaultDateIso) : formatDateUk(todayIso());
  const showVatColumn = vatRegistered && config.hasVat;

  const [rows, setRows] = useState<Row[]>(() => [
    makeBlankRow(vatRegistered, config.analysisLedger ?? '', {}, defaultDateUk),
  ]);
  const [postingProgress, setPostingProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState('');
  /** Rec-lock warning state. When set, the user is staring at the
   *  RecLockWarningModal and the post is paused waiting on Cancel /
   *  "Post anyway". `pendingLive` is the validated list of rows that
   *  doPost() will commit on confirm. */
  const [recLockHits, setRecLockHits] = useState<RecLockHit[]>([]);
  const [pendingLive, setPendingLive] = useState<Array<{ r: Row; idx: number; c: ReturnType<typeof calcRow> }> | null>(null);
  const [recent, setRecent] = useState<Transaction[]>([]);
  const [loadingRecent, setLoadingRecent] = useState(true);

  // VAT routing account ids, fetched once per book.
  const [vatInputId, setVatInputId]   = useState<string | null>(null);
  const [vatOutputId, setVatOutputId] = useState<string | null>(null);

  // Row actions (edit / duplicate / delete / audit) for the Recent table.
  const rowActions = useTransactionRowActions({
    bookId,
    vatRegistered,
    vatLockDate: vatLockDate ?? null,
    onChanged: () => void refreshRecent(),
  });

  // Used to focus the first cell of a newly-appended row (after a Tab-add).
  const pendingFocusRowId = useRef<string | null>(null);
  const tableRef = useRef<HTMLTableElement>(null);
  useEffect(() => {
    const id = pendingFocusRowId.current;
    if (!id) return;
    const el = tableRef.current?.querySelector<HTMLInputElement>(`input[data-row-id="${id}"][data-cell="date"]`);
    el?.focus();
    el?.select();
    pendingFocusRowId.current = null;
  }, [rows.length]);

  // ── Reset rows when type or VAT-status changes ────────────────────────────
  useEffect(() => {
    setRows([makeBlankRow(vatRegistered, config.analysisLedger ?? '', {}, defaultDateUk)]);
    setError('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type, vatRegistered, config.hasVat, config.analysisLedger]);

  // ── Load recent + VAT account ids ─────────────────────────────────────────
  async function refreshRecent() {
    setLoadingRecent(true);
    try {
      const r = await fetch(`/api/bookkeeping/books/${bookId}/transactions?type=${type}&limit=20`);
      if (r.ok) {
        const d = await r.json();
        setRecent((d.transactions ?? []) as Transaction[]);
      }
    } finally {
      setLoadingRecent(false);
    }
  }
  useEffect(() => { void refreshRecent(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [bookId, type]);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/bookkeeping/books/${bookId}/vat-accounts`)
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (cancelled || !d) return;
        setVatInputId(d.input_account_id ?? null);
        setVatOutputId(d.output_account_id ?? null);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [bookId]);

  // ── Row mutations ────────────────────────────────────────────────────────
  function updateRow(id: string, patch: Partial<Row>) {
    setRows(prev => prev.map(r => r.id === id ? { ...r, ...patch } : r));
  }
  function addRowInheriting(): Row {
    // New rows copy date / primary / VAT from the LAST row so bulk entry
    // doesn't need to re-set them every line.
    const last = rows[rows.length - 1];
    const seed: Partial<Row> = last ? {
      date: last.date,
      primary: last.primary,
      vatTreatment: last.vatTreatment,
      analysisLedger: last.analysisLedger || config.analysisLedger || '',
    } : {};
    return makeBlankRow(vatRegistered, config.analysisLedger ?? '', seed, defaultDateUk);
  }
  function appendRow() {
    setRows(prev => [...prev, makeBlankRow(vatRegistered, config.analysisLedger ?? '', (() => {
      const last = prev[prev.length - 1];
      return last ? {
        date: last.date,
        primary: last.primary,
        vatTreatment: last.vatTreatment,
        analysisLedger: last.analysisLedger || config.analysisLedger || '',
      } : {};
    })(), defaultDateUk)]);
  }
  function removeRow(id: string) {
    setRows(prev => prev.length <= 1 ? prev : prev.filter(r => r.id !== id));
  }
  function resetToBlanks() {
    setRows([makeBlankRow(vatRegistered, config.analysisLedger ?? '', {}, defaultDateUk)]);
  }

  // ── Per-row VAT calc ─────────────────────────────────────────────────────
  function calcRow(r: Row) {
    const total = parseAmount(r.totalText);
    const rate = showVatColumn ? rateFor(r.vatTreatment) : 0;
    const { vat, net } = splitVatFromGross(total, rate);
    return { total, rate, vat, net };
  }
  const rowCalcs = useMemo(() => rows.map(calcRow), [rows, showVatColumn]); // eslint-disable-line react-hooks/exhaustive-deps

  // Late-entry detection per row. Drives the date-cell amber ring and the
  // summary card below the grid. We derive both the flag and the original-
  // period-display text in one pass so the JSX stays clean.
  const lateRows = useMemo(() => rows.map((r, i) => {
    const c = rowCalcs[i];
    return isLateEntry(r, vatLockDate, c.rate);
  }), [rows, rowCalcs, vatLockDate]);
  const hasLateRows = lateRows.some(Boolean);

  // ── Post all non-blank rows ──────────────────────────────────────────────
  // handlePost runs validation + the rec-lock check, then either shows the
  // warning lightbox or hands straight off to doPost. The latter is the
  // actual network loop and is also the confirm path on the modal.
  async function handlePost() {
    setError('');

    // Identify rows that have enough to post. Total can be 0 — zero-amount
    // transactions are legitimate "reminder" entries that show up on the
    // ledger as a placeholder for something the user hasn't valued yet.
    // Negative totals are still rejected; VT convention is to flip the type
    // (PAY ↔ REC, SIN ↔ SCR, etc.) instead of using a negative sign.
    const live = rows
      .map((r, idx) => ({ r, idx, c: rowCalcs[idx] }))
      .filter(({ r, c }) => r.primary && r.analysis && c.total >= 0);

    if (live.length === 0) {
      setError('Add at least one row with a primary account and an analysis account. Total can be 0 for placeholder entries.');
      return;
    }

    // Validate each
    for (const { r, idx } of live) {
      const lineNo = idx + 1;
      const iso = parseDate(r.date);
      if (!iso) { setError(`Row ${lineNo}: "${r.date}" isn't a valid date — use dd/mm/yyyy (or * for today).`); return; }
      if (r.primary!.id === r.analysis!.id) { setError(`Row ${lineNo}: Primary and analysis must be different accounts.`); return; }
    }

    // Rec-lock probe — gather every (bank-ledger account, date) pair this
    // batch will touch. Both primary AND analysis are probed since contra
    // entries (TRF and similar) put the bank account on the analysis leg.
    // Non-bank accounts come back `locked:false` from the endpoint so
    // pre-filtering isn't strictly required, but trimming saves us a few
    // round-trips on big PIN/SIN batches that never touch bank.
    const probes: RecLockProbe[] = [];
    for (const { r } of live) {
      const iso = parseDate(r.date);
      if (!iso) continue;
      if (r.primary && r.primary.ledger === 'Bank') {
        probes.push({ accountId: r.primary.id, date: iso, accountName: `${r.primary.ledger}: ${r.primary.name}` });
      }
      if (r.analysis && r.analysis.ledger === 'Bank') {
        probes.push({ accountId: r.analysis.id, date: iso, accountName: `${r.analysis.ledger}: ${r.analysis.name}` });
      }
    }
    if (probes.length > 0) {
      const hits = await checkRecLock(bookId, probes);
      if (hits.length > 0) {
        // Hand off to the modal. doPost runs on confirm; cancel just
        // clears the pending state and we go nowhere.
        setRecLockHits(hits);
        setPendingLive(live);
        return;
      }
    }

    await doPost(live);
  }

  /** The actual network loop — extracted so the rec-lock warning can call
   *  it on confirm. Stays in this closure so it inherits all the row /
   *  VAT / progress state without prop-drilling. */
  async function doPost(live: Array<{ r: Row; idx: number; c: ReturnType<typeof calcRow> }>) {
    setPostingProgress({ done: 0, total: live.length });
    try {
      for (let i = 0; i < live.length; i++) {
        const { r, idx, c } = live[i];
        const iso = parseDate(r.date);
        const splits = buildSplits({
          config,
          primaryAccountId: r.primary!.id,
          analysisAccountId: r.analysis!.id,
          total: c.total, vat: c.vat, net: c.net,
          vatInputAccountId: vatInputId,
          vatOutputAccountId: vatOutputId,
          entryDetails: r.entryDetails || null,
          notes: r.notes || null,
        });

        // Late-entry flag — only carries meaning when the row's date is in
        // the VAT-locked period AND it carries VAT. The server uses this to
        // set vat_period_override. If the user has unticked includeInNextReturn
        // and the row IS in a locked period, the server will 409; we surface
        // that error per row.
        const rowIsLate = lateRows[idx];
        const lateEntry = rowIsLate && r.includeInNextReturn;

        const res = await fetch(`/api/bookkeeping/books/${bookId}/transactions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type,
            date: iso,
            payee_text: r.details || null,
            details: r.details || null,
            total: c.total,
            vat_total: showVatColumn ? c.vat : 0,
            vat_rate: showVatColumn ? c.rate : null,
            vat_treatment: showVatColumn ? r.vatTreatment : null,
            primary_account_id: r.primary!.id,
            splits,
            late_entry: lateEntry,
          }),
        });
        if (!res.ok) {
          const d = await res.json().catch(() => ({}));
          // 409 with error code "late_entry_required" means the row was in
          // a filed VAT period but the user had unticked the flag.
          if (res.status === 409 && d.error === 'late_entry_required') {
            throw new Error(`Row ${idx + 1}: ${d.message ?? 'Date falls in a filed VAT period — tick "Include in next return" or change the date.'}`);
          }
          throw new Error(`Row ${idx + 1}: ${d.error ?? 'Post failed'}`);
        }
        const d = await res.json();
        onPosted?.(d.transaction as Transaction);
        setPostingProgress({ done: i + 1, total: live.length });
      }

      resetToBlanks();
      void refreshRecent();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Post failed');
    } finally {
      setPostingProgress(null);
    }
  }

  function handleKey(e: React.KeyboardEvent) {
    const posting = postingProgress !== null;
    if (e.key === 'Enter' && !e.shiftKey && !posting) {
      const target = e.target as HTMLElement;
      if (target.closest('[role="listbox"]')) return;
      if (target.tagName === 'SELECT') return;
      e.preventDefault();
      void handlePost();
    } else if (e.key === 'Escape') {
      resetToBlanks();
      setError('');
    } else if (e.key === 'F9') {
      e.preventDefault();
      cloneFromMostRecent(e.ctrlKey || e.metaKey);
    }
  }

  // ── F9 clone — appends a new row populated from the latest transaction ───
  function cloneFromMostRecent(advanceOneMonth: boolean) {
    const last = recent[0];
    if (!last) { setError(`No previous ${type} transaction to copy.`); return; }
    setError('');

    let isoDate = last.date;
    if (advanceOneMonth) {
      const d = new Date(isoDate);
      d.setMonth(d.getMonth() + 1);
      isoDate = d.toISOString().slice(0, 10);
    }

    const primaryRef: BookAccountRef | null = last.primary_account
      ? {
          id: last.primary_account.id,
          name: last.primary_account.name,
          ledger: last.primary_account.ledger,
          account_type: last.primary_account.account_type,
        }
      : null;
    const analysisSplit = last.splits?.find(s => s.account_id !== last.primary_account_id);
    const analysisRef: BookAccountRef | null = analysisSplit?.account
      ? {
          id: analysisSplit.account.id,
          name: analysisSplit.account.name,
          ledger: analysisSplit.account.ledger,
          account_type: analysisSplit.account.account_type,
        }
      : null;

    const cloned: Row = {
      id: Math.random().toString(36).slice(2),
      date: formatDateUk(isoDate),
      primary: primaryRef,
      details: last.details ?? '',
      totalText: Number(last.total).toFixed(2),
      vatTreatment: (last.vat_treatment ?? (vatRegistered && config.hasVat ? 'standard_20' : 'no_vat')) as VatTreatment,
      analysisLedger: analysisRef?.ledger ?? config.analysisLedger ?? '',
      analysis: analysisRef,
      entryDetails: analysisSplit?.entry_details ?? '',
      notes: analysisSplit?.notes ?? '',
    };

    // Replace a trailing fully-empty row if there is one, otherwise append.
    setRows(prev => {
      const lastRow = prev[prev.length - 1];
      const isEmptyTail = lastRow && !lastRow.primary && !lastRow.analysis && !lastRow.totalText && !lastRow.details;
      if (isEmptyTail) return [...prev.slice(0, -1), cloned, makeBlankRow(vatRegistered, config.analysisLedger ?? '', { date: cloned.date }, defaultDateUk)];
      return [...prev, cloned];
    });

    setTimeout(() => {
      tableRef.current?.querySelector<HTMLInputElement>(`input[data-row-id="${cloned.id}"][data-cell="total"]`)?.focus();
    }, 0);
  }

  // ── Payee-template fill (per row) ────────────────────────────────────────
  function handlePayeePicked(rowId: string, p: PayeeSuggestion) {
    setRows(prev => prev.map(r => r.id !== rowId ? r : ({
      ...r,
      details: p.payee_display,
      analysis: p.analysis_account
        ? {
            id: p.analysis_account.id,
            name: p.analysis_account.name,
            ledger: p.analysis_account.ledger,
            account_type: r.analysis?.account_type ?? 'asset',
          }
        : r.analysis,
      analysisLedger: p.analysis_account?.ledger ?? r.analysisLedger,
      vatTreatment: vatRegistered && config.hasVat && p.vat_treatment
        ? p.vat_treatment
        : r.vatTreatment,
      entryDetails: !r.entryDetails && p.entry_details ? p.entry_details : r.entryDetails,
    })));
    setTimeout(() => {
      tableRef.current?.querySelector<HTMLInputElement>(`input[data-row-id="${rowId}"][data-cell="total"]`)?.focus();
    }, 0);
  }

  async function handleDelete(txId: string) {
    if (!confirm('Delete this transaction? The reference number will not be reused.')) return;
    const r = await fetch(`/api/bookkeeping/books/${bookId}/transactions/${txId}`, { method: 'DELETE' });
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      alert(d.error ?? 'Delete failed');
      return;
    }
    void refreshRecent();
  }

  // ── Render ──────────────────────────────────────────────────────────────
  const posting = postingProgress !== null;
  return (
    <div onKeyDown={handleKey} className="space-y-3">
      {/* Type selector */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="inline-flex items-center rounded-lg border border-slate-200 bg-white shadow-sm overflow-hidden">
          {TYPE_ORDER.map((t, i) => {
            const description = t === 'JRN'
              ? 'Journal entry'
              : t === 'RJN'
              ? 'Reversing journal — auto-reverses on a chosen date'
              : t === 'YET'
              ? 'Year-end transaction — closing journal posted on the FY end date'
              : t === 'DVT'
              ? 'Deferred VAT transfer — moves import VAT between control accounts'
              : TRANSACTION_TYPE_CONFIG[t as keyof typeof TRANSACTION_TYPE_CONFIG]?.description ?? '';
            const active = t === type;
            const familyClasses = FAMILY_PILL_CLASSES[familyOf(t)];
            const showDivider = i > 0 && (t === 'SIN' || t === 'PIN' || t === 'JRN' || t === 'WOF');
            return (
              <span key={t} className="inline-flex items-center">
                {showDivider && <span aria-hidden className="w-px h-5 bg-slate-200" />}
                <button
                  type="button"
                  onClick={() => onTypeChange(t)}
                  title={description}
                  className={`px-3 py-1.5 text-[11px] font-semibold tracking-wide transition-colors ${
                    active ? familyClasses.active : familyClasses.inactive
                  }`}
                >
                  {t}
                </button>
              </span>
            );
          })}
        </div>
        <span className="text-xs text-slate-500">{config.description}</span>
        {!vatRegistered && config.hasVat && (
          <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-slate-50 text-slate-600 border border-slate-200">
            Non-VAT book — gross only
          </span>
        )}
        {vatRegistered && config.hasVat && config.vatDirection === 'input' && !vatInputId && (
          <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-amber-50 text-amber-700 border border-amber-200">
            No Creditors: VAT - Input account — VAT will be lumped into analysis
          </span>
        )}
        {vatRegistered && config.hasVat && config.vatDirection === 'output' && !vatOutputId && (
          <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-amber-50 text-amber-700 border border-amber-200">
            No Creditors: VAT - Output account — VAT will be lumped into analysis
          </span>
        )}
      </div>

      {/* Inline action toolbar — mirrors JournalInputSheet. */}
      <div className="flex items-center gap-3 flex-wrap text-xs">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Entries</span>
        <div className="flex-1" />
        <button
          type="button"
          onClick={appendRow}
          className="text-indigo-700 hover:underline"
        >
          Insert row
        </button>
        <span className="text-slate-300">·</span>
        <button
          type="button"
          onClick={() => setRows(prev => prev.length <= 1 ? prev : prev.slice(0, -1))}
          disabled={rows.length <= 1}
          className="text-indigo-700 hover:underline disabled:text-slate-400 disabled:no-underline disabled:cursor-not-allowed"
        >
          Delete row
        </button>
        <span className="text-slate-300">·</span>
        <button
          type="button"
          onClick={resetToBlanks}
          className="text-indigo-700 hover:underline"
        >
          Delete all rows
        </button>
        <span className="text-slate-300">·</span>
        <button
          type="button"
          onClick={() => setRows(prev => prev.map(r => ({ ...r, totalText: '' })))}
          className="text-indigo-700 hover:underline"
        >
          Clear all amounts
        </button>
      </div>

      {/* Entry grid */}
      <div className="border border-slate-300 rounded-md overflow-hidden bg-white">
        <table ref={tableRef} className="w-full text-sm border-collapse">
          <thead className="bg-slate-100 text-[10px] font-semibold text-slate-600 uppercase tracking-wide">
            <tr>
              <th className="px-2 py-1.5 text-center w-9 border-r border-slate-300">#</th>
              <th className="px-2 py-1.5 text-left w-32 border-r border-slate-300">Date</th>
              <th className="px-2 py-1.5 text-left w-48 border-r border-slate-300">{config.primaryLabel}</th>
              <th className="px-2 py-1.5 text-left border-r border-slate-300">Details (payee)</th>
              <th className="px-2 py-1.5 text-right w-24 border-r border-slate-300">{showVatColumn ? 'Total' : 'Amount'}</th>
              {showVatColumn && <th className="px-2 py-1.5 text-left w-36 border-r border-slate-300">VAT</th>}
              {showVatColumn && <th className="px-2 py-1.5 text-right w-24 border-r border-slate-300">Net</th>}
              <th className="px-2 py-1.5 text-left w-44 border-r border-slate-300">Ledger</th>
              <th className="px-2 py-1.5 text-left w-56 border-r border-slate-300">{config.analysisLabel}</th>
              <th className="px-2 py-1.5 text-left">Entry details</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, idx) => {
              const isLastRow = idx === rows.length - 1;
              const c = rowCalcs[idx];
              return (
                <tr key={r.id} className="border-t border-slate-200 align-top">
                  {/* # / hover-trash */}
                  <td className="px-2 py-0 w-9 border-r border-slate-200 text-center bg-slate-50 group relative">
                    <span className="text-[11px] text-slate-500 tabular-nums group-hover:invisible">{idx + 1}</span>
                    <button
                      type="button"
                      onClick={() => removeRow(r.id)}
                      disabled={rows.length <= 1}
                      aria-label={`Remove row ${idx + 1}`}
                      className="absolute inset-0 flex items-center justify-center text-rose-500 hover:text-rose-700 opacity-0 group-hover:opacity-100 disabled:hidden"
                    >
                      <Trash2 size={11} />
                    </button>
                  </td>

                  {/* Date — amber-ringed when the date falls in a filed VAT
                      period (handled as a late entry; see card below grid). */}
                  <td className={`px-0 py-0 border-r border-slate-200 ${
                    lateRows[idx] ? 'bg-amber-50/40' : ''
                  }`}>
                    <DateInput
                      value={r.date}
                      onChange={v => updateRow(r.id, { date: v })}
                      data-row-id={r.id}
                      data-cell="date"
                      className={`px-2 py-1.5 border-0 bg-transparent focus:outline-none focus:ring-2 focus:ring-inset ${
                        lateRows[idx] ? 'focus:ring-amber-500' : 'focus:ring-indigo-500'
                      }`}
                    />
                  </td>

                  {/* Primary */}
                  <td className="px-1 py-0 border-r border-slate-200">
                    <AccountPicker
                      bookId={bookId}
                      value={r.primary?.id ?? null}
                      valueDisplay={r.primary ? r.primary.name : undefined}
                      onChange={a => updateRow(r.id, { primary: a })}
                      ledgerFilter={config.primaryLedger ?? undefined}
                      placeholder={`${config.primaryLabel}…`}
                      className="!border-none"
                    />
                  </td>

                  {/* Details (payee) */}
                  <td className="px-1 py-0 border-r border-slate-200">
                    <PayeeAutocomplete
                      bookId={bookId}
                      type={type}
                      value={r.details}
                      onChange={v => updateRow(r.id, { details: v })}
                      onSelectPayee={p => handlePayeePicked(r.id, p)}
                      placeholder={
                        config.family === 'sales' || config.family === 'purchases'
                          ? 'Invoice description / reference'
                          : 'Payee / description'
                      }
                      inputAttrs={{ 'data-row-id': r.id, 'data-cell': 'details' } as React.InputHTMLAttributes<HTMLInputElement>}
                    />
                  </td>

                  {/* Total */}
                  <td className="px-0 py-0 border-r border-slate-200">
                    <input
                      data-row-id={r.id}
                      data-cell="total"
                      type="text"
                      inputMode="decimal"
                      value={r.totalText}
                      onChange={e => updateRow(r.id, { totalText: e.target.value })}
                      placeholder="0.00"
                      className="w-full text-sm px-2 py-1.5 border-0 bg-transparent text-right focus:outline-none focus:ring-2 focus:ring-inset focus:ring-indigo-500 tabular-nums"
                    />
                  </td>

                  {/* VAT */}
                  {showVatColumn && (
                    <td className="px-0 py-0 border-r border-slate-200">
                      <select
                        data-row-id={r.id}
                        data-cell="vat"
                        value={r.vatTreatment}
                        onChange={e => updateRow(r.id, { vatTreatment: e.target.value as VatTreatment })}
                        className="w-full text-sm px-2 py-1.5 border-0 bg-transparent focus:outline-none focus:ring-2 focus:ring-inset focus:ring-indigo-500"
                      >
                        {VAT_TREATMENT_OPTIONS.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
                      </select>
                    </td>
                  )}

                  {/* Net */}
                  {showVatColumn && (
                    <td className="px-0 py-0 border-r border-slate-200">
                      <div className="text-sm px-2 py-1.5 text-right text-slate-600 tabular-nums">
                        {c.total > 0 ? formatMoneyAbs(c.net) : ''}
                      </div>
                    </td>
                  )}

                  {/* Analysis ledger */}
                  <td className="px-1 py-0 border-r border-slate-200">
                    <LedgerPicker
                      value={r.analysisLedger}
                      onChange={newLedger => updateRow(r.id, {
                        analysisLedger: newLedger,
                        analysis: r.analysis && r.analysis.ledger === newLedger ? r.analysis : null,
                      })}
                      disabled={Boolean(config.analysisLedger)}
                      placeholder="Ledger…"
                      className="!border-none"
                    />
                  </td>

                  {/* Analysis account */}
                  <td className="px-1 py-0 border-r border-slate-200">
                    <AccountPicker
                      bookId={bookId}
                      value={r.analysis?.id ?? null}
                      valueDisplay={r.analysis ? r.analysis.name : undefined}
                      onChange={a => updateRow(r.id, {
                        analysis: a,
                        analysisLedger: a?.ledger ?? r.analysisLedger,
                      })}
                      ledgerFilter={r.analysisLedger || undefined}
                      disabled={!r.analysisLedger}
                      placeholder={r.analysisLedger ? `${config.analysisLabel}…` : 'Pick ledger first'}
                      className="!border-none"
                    />
                  </td>

                  {/* Entry details — Tab off this cell on the last row appends a new line */}
                  <td className="px-0 py-0">
                    <input
                      data-row-id={r.id}
                      data-cell="entryDetails"
                      type="text"
                      value={r.entryDetails}
                      onChange={e => updateRow(r.id, { entryDetails: e.target.value })}
                      onKeyDown={e => {
                        if (e.key === 'Tab' && !e.shiftKey && isLastRow) {
                          e.preventDefault();
                          const next = addRowInheriting();
                          pendingFocusRowId.current = next.id;
                          setRows(prev => [...prev, next]);
                        }
                      }}
                      placeholder="Entry note"
                      className="w-full text-sm px-2 py-1.5 border-0 bg-transparent focus:outline-none focus:ring-2 focus:ring-inset focus:ring-indigo-500"
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Late-entry summary — appears only when at least one row's date is
          in the VAT-locked period. Per-row checkboxes default to ticked. */}
      {hasLateRows && (
        <div className="rounded-md border border-amber-200 bg-amber-50/60 px-3 py-2.5">
          <div className="flex items-start gap-2">
            <span className="mt-0.5 text-amber-600" aria-hidden>⚠</span>
            <div className="flex-1 min-w-0">
              <div className="text-xs font-semibold text-amber-900">
                Late VAT entries — {lateRows.filter(Boolean).length} {lateRows.filter(Boolean).length === 1 ? 'row' : 'rows'} fall in a filed VAT period
              </div>
              <div className="text-[11px] text-amber-800/90 mt-0.5">
                The VAT period is locked through{' '}
                <span className="font-mono">{vatLockDate}</span>. By default these are
                flagged to be carried into the next VAT return. Untick any you'd rather not include
                (you'll need to change the date or have an admin unfile the period instead).
              </div>
              <ul className="mt-2 space-y-1">
                {rows.map((r, i) => {
                  if (!lateRows[i]) return null;
                  const c = rowCalcs[i];
                  return (
                    <li key={r.id}>
                      <label className="inline-flex items-center gap-2 text-xs text-amber-900 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={r.includeInNextReturn}
                          onChange={e => updateRow(r.id, { includeInNextReturn: e.target.checked })}
                          className="rounded border-amber-300 text-amber-600 focus:ring-amber-500"
                        />
                        <span>
                          <span className="font-medium">Row {i + 1}</span> · {r.date}
                          {r.details ? ` · ${r.details}` : ''}
                          {' · '}
                          <span className="tabular-nums">£{formatMoneyAbs(c.total)}</span>
                          {' '}
                          (VAT <span className="tabular-nums">£{formatMoneyAbs(c.vat)}</span>)
                          {r.includeInNextReturn
                            ? <span className="ml-1 text-amber-700">— will be included in next return</span>
                            : <span className="ml-1 text-rose-700">— will fail to post (period locked)</span>}
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>
        </div>
      )}

      {/* Post bar */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex-1" />
        {posting && postingProgress && (
          <span className="text-xs text-slate-500 tabular-nums">
            Posting {postingProgress.done} of {postingProgress.total}…
          </span>
        )}
        <button
          type="button"
          onClick={() => void handlePost()}
          disabled={posting}
          className="btn-primary inline-flex items-center gap-2 disabled:opacity-60"
        >
          {posting ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
          Post {type}
        </button>
      </div>

      {error && (
        <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          {error}
        </div>
      )}

      <p className="text-[11px] text-gray-500">
        <span className="font-semibold">Enter</span> posts all rows ·{' '}
        <span className="font-semibold">Esc</span> resets ·{' '}
        <span className="font-semibold">Tab</span> moves between cells (and adds a new row at the end) ·{' '}
        <span className="font-semibold">*</span> in Date = today ·{' '}
        <span className="font-semibold">F9</span> clone last {type} ·{' '}
        <span className="font-semibold">Ctrl+F9</span> clone + advance one month.
      </p>

      {/* Recent posted transactions of the current type */}
      <div>
        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
          Recent {type} ({recent.length})
        </h3>
        {loadingRecent ? (
          <div className="text-sm text-gray-400 flex items-center gap-2">
            <Loader2 size={12} className="animate-spin" /> Loading…
          </div>
        ) : recent.length === 0 ? (
          <p className="text-sm text-gray-400">No {type} transactions yet — post your first one above.</p>
        ) : (
          <div className="border border-gray-200 rounded-lg overflow-hidden bg-white">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-[10px] font-semibold text-gray-500 uppercase tracking-wide">
                <tr>
                  <th className="px-2 py-1.5 text-left">Date</th>
                  <th className="px-2 py-1.5 text-left">Ref</th>
                  <th className="px-2 py-1.5 text-left">Details</th>
                  <th className="px-2 py-1.5 text-right">{showVatColumn ? 'Total' : 'Amount'}</th>
                  {showVatColumn && <th className="px-2 py-1.5 text-right">VAT</th>}
                  <th className="px-2 py-1.5 text-left">Primary</th>
                  <th className="px-2 py-1.5 text-left">Analysis</th>
                  <th className="px-2 py-1.5 w-12" />
                </tr>
              </thead>
              <tbody>
                {recent.map(t => {
                  const analysis = t.splits?.find(s => s.account_id !== t.primary_account_id);
                  return (
                    <tr key={t.id} {...rowActions.rowProps(t)} className={`border-t border-gray-100 ${rowActions.rowProps(t).className}`}>
                      <td className="px-2 py-1.5 text-gray-700">{formatDateUk(t.date)}</td>
                      <td className="px-2 py-1.5 text-xs"><TxnRefLink txn={t} className="text-xs" /></td>
                      <td className="px-2 py-1.5 text-gray-900">{t.details ?? ''}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{formatMoneyAbs(Number(t.total))}</td>
                      {showVatColumn && (
                        <td className="px-2 py-1.5 text-right tabular-nums text-gray-500">
                          {Number(t.vat_total) > 0 ? formatMoneyAbs(Number(t.vat_total)) : ''}
                        </td>
                      )}
                      <td className="px-2 py-1.5"><AccountLink account={t.primary_account ?? null} /></td>
                      <td className="px-2 py-1.5"><AccountLink account={analysis?.account ?? null} /></td>
                      <td className="px-2 py-1.5 text-right">
                        {rowActions.renderActions(t)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {rowActions.menus}

      {/* Rec-lock warning lightbox — only mounted when handlePost detects
          a reconciled-period collision. Confirm = run doPost on the
          stored pendingLive; Cancel = drop the pending state and go
          back to the sheet untouched. */}
      {recLockHits.length > 0 && pendingLive && (
        <RecLockWarningModal
          hits={recLockHits}
          onCancel={() => { setRecLockHits([]); setPendingLive(null); }}
          onConfirm={() => {
            const live = pendingLive;
            setRecLockHits([]);
            setPendingLive(null);
            void doPost(live);
          }}
        />
      )}
    </div>
  );
}
