'use client';

/**
 * BankRecDetailModal — VT-style read-only summary of a single bank rec.
 *
 *   ┌───────────────────────────────────────────────────────────────────┐
 *   │ [icon] Rec 1 Apr → 31 Mar 2025         Print  Export  Reopen  X   │
 *   │ Bank: Current account · RECONCILED ✓                              │
 *   ├───────────────────────────────────────────────────────────────────┤
 *   │ <printable area starts here>                                      │
 *   │ Vawzen Solutions Limited                                          │
 *   │ Bank: Current account — bank is reconciled up to 31/03/2025       │
 *   │                                                                   │
 *   │ Date    Reference  Details         A   Payments  Receipts  Total  │
 *   │ Opening balance                                              0.00 │
 *   │ 31/03/25 REC 000006 MOA Money …    §              20.00          │
 *   │ ...                                                               │
 *   │ Movement                              36,037.36 43,334.69 7,297.33│
 *   │ Closing balance                                          7,297.33 │
 *   └───────────────────────────────────────────────────────────────────┘
 *
 * This component is the "open a reconciled rec for review" view — the
 * matching workflow for active recs now lives in BankRecWorkspace, so
 * this modal is purely a printable summary + audit/Reopen/Delete entry
 * point. The on-screen layout deliberately mirrors VT Transaction+'s
 * printed bank-rec report so internal staff can use it interchangeably
 * with the legacy software during the transition.
 *
 * Data source: /bank-imports/[id]/workspace — gives us the cleared
 * splits with their parent transaction in one round-trip.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Loader2, AlertCircle, X, FileText, Lock, RotateCcw,
  Printer, Download, Trash2, Check,
} from 'lucide-react';
import Tooltip from '@/components/ui/Tooltip';
import ReportPrintHeader from '../reports/ReportPrintHeader';
import { printReport } from '../reports/printReport';
import { exportRowsAsCsv, type CsvRow } from '../reports/exportReportCsv';
import { TxnRefLink } from '../book/BookNavigationContext';
import type { TransactionType } from '@/types/bookkeeping';

interface Props {
  bookId: string;
  importId: string;
  accountId: string;
  accountName: string;
  /** Legacy prop — pre-loaded ledger entries from the parent. No longer
   *  consumed (we fetch the workspace shape ourselves) but kept on the
   *  signature so existing callers don't have to change. */
  entries?: LedgerEntry[];
  /** Optional book period lock date (YYYY-MM-DD). When set, Reopen is
   *  blocked if the rec's period ends on or before this date. */
  periodLockDate?: string | null;
  onClose: () => void;
  onChanged: () => void;
}

interface LedgerEntry {
  split_id: string;
  transaction_id: string;
  ref_no: string;
  date: string;
  details: string | null;
  entry_details: string | null;
  debit: number;
  credit: number;
}

// ── Workspace endpoint shape (the bits we need) ─────────────────────────────
interface RecHeader {
  id: string;
  account_id: string;
  display_label: string | null;
  file_name: string;
  period_start: string | null;
  period_end:   string | null;
  opening_balance: number | null;
  closing_balance: number | null;
  status: 'pending' | 'in_progress' | 'reconciled' | 'abandoned';
  notes: string | null;
  reconciled_at: string | null;
}
interface SplitRow {
  id: string;
  transaction_id: string;
  debit: number;
  credit: number;
  entry_details: string | null;
  cleared_in_rec_id: string | null;
  transaction: {
    id: string; type: string; ref_no: string; date: string;
    details: string | null; payee_text: string | null;
  };
}
interface WorkspaceResponse {
  import: RecHeader;
  cleared_splits: SplitRow[];
  totals: { opening: number; cleared_total: number; closing: number | null; gap: number | null };
}

// ── Formatting helpers ──────────────────────────────────────────────────────
function formatDateUk(iso: string | null | undefined): string {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  if (!y || !m || !d) return iso;
  return `${d}/${m}/${y}`;
}
function fmt(n: number | null | undefined): string {
  if (n == null) return '';
  if (Math.abs(n) < 0.005) return '0.00';
  return Number(n).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function BankRecDetailModal({
  bookId, importId, accountId, accountName, periodLockDate, onClose, onChanged,
}: Props) {
  void accountId; // not used in the read-only layout but kept on the prop for upstream compat
  const [imp,    setImp]    = useState<RecHeader | null>(null);
  const [splits, setSplits] = useState<SplitRow[]>([]);
  const [opening, setOpening] = useState<number>(0);
  const [closing, setClosing] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy]       = useState(false);
  const [error, setError]     = useState<string | null>(null);

  // Print root — printReport copies this subtree into a fresh popup window.
  const printRootRef = useRef<HTMLDivElement>(null);

  // ── Load ──────────────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`/api/bookkeeping/books/${bookId}/bank-imports/${importId}/workspace`);
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        setError(d.error ?? 'Failed to load reconciliation');
        return;
      }
      const d = await r.json() as WorkspaceResponse;
      setImp(d.import);
      setSplits(d.cleared_splits);
      setOpening(Number(d.totals.opening ?? 0));
      setClosing(d.totals.closing != null ? Number(d.totals.closing) : null);
    } finally {
      setLoading(false);
    }
  }, [bookId, importId]);
  useEffect(() => { void load(); }, [load]);

  // ── Derived: sorted entries + totals ─────────────────────────────────────
  const sortedSplits = useMemo(() => {
    return [...splits].sort((a, b) => {
      const da = a.transaction.date ?? '';
      const db = b.transaction.date ?? '';
      if (da !== db) return da < db ? -1 : 1;
      return (a.transaction.ref_no ?? '').localeCompare(b.transaction.ref_no ?? '');
    });
  }, [splits]);

  // On a bank account: debit = receipt (money in), credit = payment (money out).
  // Movement = receipts − payments. Closing = opening + movement.
  const totals = useMemo(() => {
    let payments = 0;
    let receipts = 0;
    for (const s of sortedSplits) {
      payments += Number(s.credit) || 0;
      receipts += Number(s.debit)  || 0;
    }
    const movement = +(receipts - payments).toFixed(2);
    return { payments, receipts, movement, calcClosing: +(opening + movement).toFixed(2) };
  }, [sortedSplits, opening]);

  // ── Reopen / Delete (kept) ───────────────────────────────────────────────
  const periodLocked = !!(periodLockDate && imp?.period_end && imp.period_end <= periodLockDate);

  async function handleReopen() {
    if (!imp) return;
    if (periodLocked) {
      setError('This reconciliation’s period is locked. Unlock the period in book settings before reopening.');
      return;
    }
    setBusy(true); setError(null);
    try {
      const r = await fetch(`/api/bookkeeping/books/${bookId}/bank-imports/${importId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'in_progress' }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        setError(d.error ?? 'Reopen failed');
        return;
      }
      await load();
      onChanged();
      onClose(); // drop back to the parent — the rec is now active again
    } finally { setBusy(false); }
  }
  async function handleDelete() {
    if (!confirm('Delete this reconciliation? All reconciled lines will be un-reconciled. This cannot be undone.')) return;
    setBusy(true); setError(null);
    try {
      const r = await fetch(`/api/bookkeeping/books/${bookId}/bank-imports/${importId}`, { method: 'DELETE' });
      if (!r.ok) { setError('Delete failed'); return; }
      onChanged();
      onClose();
    } finally { setBusy(false); }
  }

  // ── Export ────────────────────────────────────────────────────────────────
  // CSV mirrors the on-screen layout: header row, opening balance, every
  // ledger row (Date | Ref | Details | A | Payments | Receipts | Total),
  // Movement row, Closing balance row. Opens cleanly in Excel.
  function handleExport() {
    if (!imp) return;
    const rows: CsvRow[] = [];
    rows.push(['Date', 'Reference', 'Details', 'A', 'Payments', 'Receipts', 'Total']);
    rows.push(['Opening balance', '', '', '', '', '', fmt(opening)]);
    for (const s of sortedSplits) {
      const isReceipt = Number(s.debit) > 0;
      const isPayment = Number(s.credit) > 0;
      rows.push([
        formatDateUk(s.transaction.date),
        s.transaction.ref_no,
        composeDetails(s),
        // Unicode check mark — same "ticked off in this rec" semantics
        // as the on-screen Check icon. The UTF-8 BOM we prepend in the
        // CSV writer means Excel renders this cleanly without any
        // codepage faffing.
        '✓',
        isPayment ? fmt(Number(s.credit)) : '',
        isReceipt ? fmt(Number(s.debit))  : '',
        '',
      ]);
    }
    rows.push(['Movement', '', '', '', fmt(totals.payments), fmt(totals.receipts), fmt(totals.movement)]);
    rows.push(['Closing balance', '', '', '', '', '', fmt(closing ?? totals.calcClosing)]);
    const label = imp.display_label || `Rec ${formatDateUk(imp.period_start)} to ${formatDateUk(imp.period_end)}`;
    exportRowsAsCsv(`Bank rec — ${accountName} — ${label}.csv`, rows);
  }

  // ── Print ─────────────────────────────────────────────────────────────────
  function handlePrint() {
    const label = imp
      ? (imp.display_label || `Bank rec ${formatDateUk(imp.period_start)} to ${formatDateUk(imp.period_end)}`)
      : 'Bank rec';
    printReport(printRootRef.current, `${label} — ${accountName}`, { orientation: 'portrait' });
  }

  // ── Header copy ───────────────────────────────────────────────────────────
  const headerTitle = useMemo(() => {
    if (!imp) return 'Reconciliation';
    if (imp.display_label) return imp.display_label;
    if (imp.period_start && imp.period_end) {
      return `Rec ${formatDateUk(imp.period_start)} → ${formatDateUk(imp.period_end)}`;
    }
    return imp.file_name || 'Reconciliation';
  }, [imp]);

  // VT-style sub-line: "Bank: Current account - bank is reconciled up to dd/mm/yyyy"
  const printSubLine = useMemo(() => {
    if (!imp) return `Bank: ${accountName}`;
    const upto = imp.status === 'reconciled' && imp.period_end
      ? ` — bank is reconciled up to ${formatDateUk(imp.period_end)}`
      : imp.status === 'abandoned'
        ? ' — abandoned'
        : ' — in progress';
    return `Bank: ${accountName}${upto}`;
  }, [imp, accountName]);

  return (
    <div className="fixed inset-0 z-[1400] flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4" onClick={onClose}>
      <div
        className="bg-white rounded-2xl w-[1100px] max-w-full shadow-2xl border border-slate-200 flex flex-col"
        style={{ height: 'calc(100vh - 4rem)' }}
        onClick={e => e.stopPropagation()}
      >
        {/* ── Header (print-hidden) ─────────────────────────────────────── */}
        <div className="px-5 py-3 border-b border-slate-200 flex items-center gap-3 print-hidden">
          <FileText size={16} className="text-indigo-600" />
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-slate-900 truncate">{headerTitle}</h2>
            <p className="text-[11px] text-slate-500">
              {accountName}
              {imp?.period_start && <> · {formatDateUk(imp.period_start)} → {formatDateUk(imp.period_end ?? imp.period_start)}</>}
              {imp && <> · <StatusBadge status={imp.status} /></>}
            </p>
          </div>

          <div className="ml-auto flex items-center gap-1.5">
            <button
              type="button"
              onClick={handlePrint}
              disabled={loading || !imp}
              className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 disabled:opacity-40"
            >
              <Printer size={12} /> Print
            </button>
            <button
              type="button"
              onClick={handleExport}
              disabled={loading || !imp}
              className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 disabled:opacity-40"
            >
              <Download size={12} /> Export
            </button>
            {imp?.status === 'reconciled' && (
              <Tooltip label={periodLocked ? 'Period is locked — unlock to reopen' : 'Reopen for editing'}>
                <button
                  type="button"
                  onClick={handleReopen}
                  disabled={busy || periodLocked}
                  className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {periodLocked ? <Lock size={12} /> : <RotateCcw size={12} />}
                  Reopen
                </button>
              </Tooltip>
            )}
            <Tooltip label="Delete this reconciliation (un-clears every split)">
              <button
                type="button"
                onClick={handleDelete}
                disabled={busy}
                className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border border-rose-200 bg-white hover:bg-rose-50 text-rose-700 disabled:opacity-40"
              >
                <Trash2 size={12} /> Delete
              </button>
            </Tooltip>
            <button onClick={onClose} aria-label="Close" className="ml-1 text-slate-400 hover:text-slate-700">
              <X size={16} />
            </button>
          </div>
        </div>

        {error && (
          <div className="px-5 py-1.5 bg-rose-50 border-b border-rose-200 text-rose-800 text-xs flex items-center gap-1.5 shrink-0 print-hidden">
            <AlertCircle size={11} /> {error}
            <button onClick={() => setError(null)} className="ml-auto text-rose-600 hover:text-rose-800"><X size={11} /></button>
          </div>
        )}

        {/* ── Body ─────────────────────────────────────────────────────── */}
        {loading || !imp ? (
          <div className="flex-1 flex items-center justify-center text-slate-400 text-sm">
            <Loader2 size={14} className="animate-spin mr-2" /> Loading…
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto">
            {/* Printable area. printReport copies this subtree into a
                fresh popup window — the wrapping classes (`bk-print-root`
                / `bk-print-area`) are matched by globals.css print rules. */}
            <div ref={printRootRef} className="bk-print-root">
              <div className="bk-print-area px-6 py-5 text-slate-900">
                <ReportPrintHeader
                  bookId={bookId}
                  reportTitle={accountName}
                  periodDescription={printSubLine}
                />

                {/* On-screen secondary sub-line (hidden in print — the
                    ReportPrintHeader above replaces it). */}
                <div className="print-hidden mb-3 text-[11px] text-slate-500">
                  {printSubLine}
                  {imp.reconciled_at && (
                    <> · reconciled {formatDateUk(imp.reconciled_at.slice(0, 10))}</>
                  )}
                </div>

                <table className="w-full text-[12px]">
                  <thead className="text-slate-600 border-b border-slate-300">
                    <tr>
                      <th className="px-2 py-1.5 text-left font-semibold w-20">Date</th>
                      <th className="px-2 py-1.5 text-left font-semibold w-24">Reference</th>
                      <th className="px-2 py-1.5 text-left font-semibold">Details</th>
                      <th className="px-2 py-1.5 text-center font-semibold w-8">A</th>
                      <th className="px-2 py-1.5 text-right font-semibold w-24">Payments</th>
                      <th className="px-2 py-1.5 text-right font-semibold w-24">Receipts</th>
                      <th className="px-2 py-1.5 text-right font-semibold w-24">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {/* Opening balance — full-width left label, total only. */}
                    <tr className="border-b border-slate-100">
                      <td colSpan={6} className="px-2 py-1.5 text-slate-700">Opening balance</td>
                      <td className="px-2 py-1.5 text-right tabular-nums font-medium">{fmt(opening)}</td>
                    </tr>

                    {sortedSplits.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="px-2 py-4 text-center text-slate-400 italic">
                          No entries were cleared in this reconciliation.
                        </td>
                      </tr>
                    ) : (
                      sortedSplits.map(s => {
                        const isPayment = Number(s.credit) > 0;
                        const isReceipt = Number(s.debit)  > 0;
                        return (
                          <tr key={s.id} className="border-b border-slate-50 align-top">
                            <td className="px-2 py-1 text-slate-700 tabular-nums whitespace-nowrap">
                              {formatDateUk(s.transaction.date)}
                            </td>
                            <td className="px-2 py-1 whitespace-nowrap">
                              {/* TxnRefLink renders the same hover popover
                                  used everywhere else in the bookkeeping
                                  module — debits on top, credits below.
                                  The popover lazy-fetches splits from the
                                  transaction detail endpoint on first hover. */}
                              <TxnRefLink
                                txn={{
                                  id: s.transaction.id,
                                  type: (s.transaction.type as TransactionType),
                                  ref_no: s.transaction.ref_no,
                                  date: s.transaction.date,
                                }}
                                className="text-[11px]"
                              />
                            </td>
                            <td className="px-2 py-1 text-slate-900">
                              <div className="truncate">{composeDetails(s)}</div>
                            </td>
                            <td className="px-2 py-1 text-center text-emerald-700">
                              <Check size={11} strokeWidth={3} className="inline-block" />
                            </td>
                            <td className="px-2 py-1 text-right tabular-nums">
                              {isPayment ? fmt(Number(s.credit)) : ''}
                            </td>
                            <td className="px-2 py-1 text-right tabular-nums">
                              {isReceipt ? fmt(Number(s.debit)) : ''}
                            </td>
                            <td />
                          </tr>
                        );
                      })
                    )}

                    {/* Movement — totals of the Payments + Receipts cols. */}
                    <tr className="border-t border-slate-300">
                      <td colSpan={4} className="px-2 py-1.5 text-slate-700">Movement</td>
                      <td className="px-2 py-1.5 text-right tabular-nums font-medium">{fmt(totals.payments)}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums font-medium">{fmt(totals.receipts)}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums font-medium">{fmt(totals.movement)}</td>
                    </tr>

                    {/* Closing balance — total only. Uses the stored
                        closing_balance when present; otherwise the
                        computed opening + movement. */}
                    <tr>
                      <td colSpan={6} className="px-2 py-1.5 text-slate-700 font-medium">Closing balance</td>
                      <td className="px-2 py-1.5 text-right tabular-nums font-semibold border-t border-slate-900">
                        {fmt(closing ?? totals.calcClosing)}
                      </td>
                    </tr>
                  </tbody>
                </table>

                {imp.notes && (
                  <div className="mt-4 text-[11px] text-slate-600">
                    <span className="font-semibold">Notes:</span> {imp.notes}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** Compose the printable "Details" cell — payee/details from the
 *  transaction header, with the per-leg entry note appended in
 *  parentheses when it adds context. The transaction type (PAY / REC /
 *  …) is already shown in the Reference column so we don't repeat it
 *  here. */
function composeDetails(s: SplitRow): string {
  const base = s.transaction.details ?? s.transaction.payee_text ?? '';
  if (s.entry_details && s.entry_details !== base) {
    return base ? `${base} — ${s.entry_details}` : s.entry_details;
  }
  return base;
}

function StatusBadge({ status }: { status: RecHeader['status'] }) {
  const label =
    status === 'pending'     ? 'pending'
    : status === 'in_progress' ? 'in progress'
    : status === 'reconciled'  ? 'RECONCILED ✓'
    : 'abandoned';
  const tone =
    status === 'reconciled'  ? 'bg-emerald-100 text-emerald-800'
    : status === 'in_progress' ? 'bg-amber-100 text-amber-800'
    : status === 'abandoned'   ? 'bg-slate-100 text-slate-500'
    : 'bg-slate-100 text-slate-700';
  return <span className={`inline-block px-1.5 py-0.5 rounded ${tone} text-[10px] font-semibold uppercase tracking-wide`}>{label}</span>;
}
