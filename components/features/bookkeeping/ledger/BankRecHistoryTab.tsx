'use client';

/**
 * BankRecHistoryTab — completed + abandoned reconciliations for a bank
 * account. Lives next to the Reconcile tab so active work and archive
 * don't share screen space.
 *
 * Layout:
 *   ┌────────────────────────────────────────────────────────────────┐
 *   │ Summary chips: 12 reconciled · 1 abandoned · Last: 31/03/2026  │
 *   │ Filter pills: All · Reconciled · Abandoned                     │
 *   ├────────────────────────────────────────────────────────────────┤
 *   │ ── 2026 ──────────────────────────────────────────────────     │
 *   │ ✓  01/03 → 31/03   Mar 2026   £8,921.09 → £3,144.30   31/03/26 │
 *   │ ✓  01/02 → 28/02   Feb 2026   £9,408.21 → £8,921.09   28/02/26 │
 *   │ ── 2025 ──────────────────────────────────────────────────     │
 *   │ ⊘  01/12 → 31/12   Dec 2025 abandoned                          │
 *   │ ...                                                            │
 *   └────────────────────────────────────────────────────────────────┘
 *
 * Click a row to open the legacy detail modal — read-only by default,
 * with a Reopen button that goes through /bank-imports/[id]/reopen and
 * respects the period-lock + newer-rec guards.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, FileText, ChevronRight, Check, Ban, CalendarRange } from 'lucide-react';
import BankRecDetailModal from './BankRecDetailModal';
import Tooltip from '@/components/ui/Tooltip';

interface Props {
  bookId: string;
  accountId: string;
  accountName: string;
  /** Ledger entries forwarded to the detail modal — same flow as the
   *  reconcile tab. */
  entries: LedgerEntry[];
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

interface BankImport {
  id: string;
  account_id: string;
  file_name: string;
  display_label: string | null;
  period_start: string | null;
  period_end: string | null;
  opening_balance: number | null;
  closing_balance: number | null;
  status: 'pending' | 'in_progress' | 'reconciled' | 'abandoned';
  uploaded_at: string;
  reconciled_at: string | null;
}

type StatusFilter = 'all' | 'reconciled' | 'abandoned';

function formatDateUk(iso?: string | null): string {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  if (!y || !m || !d) return iso;
  return `${d}/${m}/${y}`;
}
function fmt(n: number | null | undefined): string {
  if (n == null) return '—';
  return Number(n).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
/** Year bucket for grouping headers. Uses period_end (or upload date when
 *  period_end is missing — shouldn't happen, but defensive). */
function yearOf(i: BankImport): string {
  const iso = i.period_end ?? i.uploaded_at.slice(0, 10);
  return iso.slice(0, 4) || '—';
}

export default function BankRecHistoryTab({
  bookId, accountId, accountName, entries, onChanged,
}: Props) {
  const [imports, setImports]     = useState<BankImport[]>([]);
  const [loading, setLoading]     = useState(true);
  const [detailImportId, setDetailImportId] = useState<string | null>(null);
  const [periodLockDate, setPeriodLockDate] = useState<string | null>(null);
  // Default to Reconciled — that's what users overwhelmingly open the
  // History tab to look at. Abandoned recs are an edge case worth keeping
  // accessible but not the landing view. The All / Abandoned pills are
  // one click away.
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('reconciled');

  // ── Fetch book once (period_lock_date used by reopen button in the modal)
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/bookkeeping/books/${bookId}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (cancelled) return;
        setPeriodLockDate(d?.book?.period_lock_date ?? null);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [bookId]);

  // ── Load imports for this account, then filter to completed/abandoned ────
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`/api/bookkeeping/books/${bookId}/bank-imports?account_id=${accountId}`);
      if (!r.ok) return;
      const d = await r.json() as { imports: BankImport[] };
      const historical = d.imports.filter(i => i.status === 'reconciled' || i.status === 'abandoned');
      // Newest first by period_end (falling back to upload time when periods
      // overlap on an account — shouldn't happen given the unique index, but
      // safe to handle).
      historical.sort((a, b) =>
        (b.period_end ?? '').localeCompare(a.period_end ?? '') ||
        b.uploaded_at.localeCompare(a.uploaded_at),
      );
      setImports(historical);
    } finally {
      setLoading(false);
    }
  }, [bookId, accountId]);
  useEffect(() => { void load(); }, [load]);

  // ── Derived stats for the summary strip ──────────────────────────────────
  const stats = useMemo(() => {
    const reconciled = imports.filter(i => i.status === 'reconciled');
    const abandoned  = imports.filter(i => i.status === 'abandoned');
    // Latest reconciled period end — used in the "Last reconciled to …" chip.
    const latest = reconciled[0]?.period_end ?? null;
    return {
      reconciledCount: reconciled.length,
      abandonedCount:  abandoned.length,
      latestPeriodEnd: latest,
    };
  }, [imports]);

  // ── Apply the visible status filter on top of the historical list ────────
  const visible = useMemo(() => {
    if (statusFilter === 'all') return imports;
    return imports.filter(i => i.status === statusFilter);
  }, [imports, statusFilter]);

  // ── Group visible rows by year for the section headers ───────────────────
  const grouped = useMemo(() => {
    const map = new Map<string, BankImport[]>();
    for (const i of visible) {
      const y = yearOf(i);
      const arr = map.get(y) ?? [];
      arr.push(i);
      map.set(y, arr);
    }
    return [...map.entries()];
  }, [visible]);

  return (
    <div className="flex flex-col h-full">
      {/* ── Header strip ──────────────────────────────────────────────────── */}
      <div className="px-4 pt-3 pb-3 border-b border-slate-100 shrink-0">
        <div className="flex items-center gap-2 mb-2">
          <h3 className="text-xs font-semibold text-slate-900 uppercase tracking-wide">History</h3>
          <span className="text-[11px] text-slate-500">· {accountName}</span>
          {loading && <Loader2 size={10} className="animate-spin text-slate-400" />}
        </div>

        {/* Stats chips — give the user a sense of progress at a glance.
            Hidden while loading + when there's nothing historical yet. */}
        {!loading && imports.length > 0 && (
          <div className="flex items-center gap-2 flex-wrap">
            <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-100">
              <Check size={10} strokeWidth={3} />
              {stats.reconciledCount} reconciled
            </span>
            {stats.abandonedCount > 0 && (
              <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-slate-50 text-slate-500 border border-slate-200">
                <Ban size={10} />
                {stats.abandonedCount} abandoned
              </span>
            )}
            {stats.latestPeriodEnd && (
              <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-100">
                <CalendarRange size={10} />
                Last reconciled to {formatDateUk(stats.latestPeriodEnd)}
              </span>
            )}

            {/* Filter pills — pushed right. "All" is default; counts on the
                two specific filters give the user a peek at what the toggle
                will do without clicking. */}
            <div className="ml-auto flex items-center gap-1">
              {([
                { id: 'all'        as const, label: 'All',        count: imports.length },
                { id: 'reconciled' as const, label: 'Reconciled', count: stats.reconciledCount },
                { id: 'abandoned'  as const, label: 'Abandoned',  count: stats.abandonedCount },
              ]).map(p => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setStatusFilter(p.id)}
                  className={`text-[11px] px-2 py-0.5 rounded-full border transition-colors ${
                    statusFilter === p.id
                      ? 'bg-slate-900 text-white border-slate-900'
                      : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  {p.label} <span className="opacity-60">{p.count}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ── Body ──────────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-12 text-xs text-slate-400">
            <Loader2 size={12} className="animate-spin mr-1.5" /> Loading…
          </div>
        ) : visible.length === 0 ? (
          <div className="flex flex-col items-center justify-center text-center py-16 px-6 text-slate-400">
            <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center mb-3">
              <FileText size={16} className="text-slate-400" />
            </div>
            <p className="text-sm font-medium text-slate-600">
              {imports.length === 0
                ? 'No completed reconciliations yet.'
                : `No ${statusFilter === 'reconciled' ? 'reconciled' : 'abandoned'} recs.`}
            </p>
            <p className="text-xs mt-1 max-w-xs">
              {imports.length === 0
                ? "Once you reconcile a period in the Reconcile tab it'll land here for review."
                : 'Try a different filter to see other recs.'}
            </p>
          </div>
        ) : (
          <div className="px-2 py-1">
            {grouped.map(([year, rows]) => (
              <div key={year} className="mb-4 last:mb-0">
                {/* Year header — sticky so it stays visible while scrolling
                    through a long history. */}
                <div className="sticky top-0 z-10 bg-white px-2 py-1.5 flex items-center gap-2 border-b border-slate-100">
                  <span className="text-[11px] uppercase tracking-wide font-semibold text-slate-600">
                    {year}
                  </span>
                  <span className="text-[11px] text-slate-400">· {rows.length}</span>
                </div>
                <table className="w-full text-xs">
                  <thead className="text-[10px] uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-3 py-1.5 text-left w-8" />
                      <th className="px-3 py-1.5 text-left">Period</th>
                      <th className="px-3 py-1.5 text-left">Label</th>
                      <th className="px-3 py-1.5 text-right">Opening</th>
                      <th className="px-3 py-1.5 text-right">Closing</th>
                      <th className="px-3 py-1.5 text-left">Completed</th>
                      <th className="px-3 py-1.5 w-8" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {rows.map(i => {
                      const isAbandoned = i.status === 'abandoned';
                      return (
                        <tr
                          key={i.id}
                          onClick={() => setDetailImportId(i.id)}
                          className={`group cursor-pointer transition-colors ${
                            isAbandoned
                              ? 'text-slate-400 hover:bg-slate-50'
                              : 'text-slate-900 hover:bg-emerald-50/40'
                          }`}
                        >
                          <td className="px-3 py-2">
                            <Tooltip label={isAbandoned ? 'Abandoned' : 'Reconciled'}>
                              <span className={`inline-flex items-center justify-center w-5 h-5 rounded ${
                                isAbandoned
                                  ? 'bg-slate-100 text-slate-400'
                                  : 'bg-emerald-50 text-emerald-700'
                              }`}>
                                {isAbandoned ? <Ban size={11} /> : <Check size={11} strokeWidth={3} />}
                              </span>
                            </Tooltip>
                          </td>
                          <td className="px-3 py-2 tabular-nums whitespace-nowrap">
                            {formatDateUk(i.period_start)} → {formatDateUk(i.period_end)}
                          </td>
                          <td className="px-3 py-2 truncate max-w-[300px]">
                            {i.display_label || i.file_name}
                            {isAbandoned && (
                              <span className="ml-1.5 text-[10px] uppercase tracking-wide font-semibold text-slate-400">
                                · abandoned
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">{fmt(i.opening_balance)}</td>
                          <td className="px-3 py-2 text-right tabular-nums font-medium">{fmt(i.closing_balance)}</td>
                          <td className="px-3 py-2 text-slate-500 tabular-nums whitespace-nowrap">
                            {i.reconciled_at ? formatDateUk(i.reconciled_at.slice(0, 10)) : '—'}
                          </td>
                          <td className="px-3 py-2 text-right text-slate-300 group-hover:text-indigo-500">
                            <ChevronRight size={12} />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Reuse legacy modal for the detail / reopen flow — it already
          handles read-only rendering, the Reopen button, and the
          period-lock + newer-rec guards. The workspace-native render
          can replace it later without changing this list. */}
      {detailImportId && (
        <BankRecDetailModal
          bookId={bookId}
          importId={detailImportId}
          accountId={accountId}
          accountName={accountName}
          entries={entries}
          periodLockDate={periodLockDate}
          onClose={() => setDetailImportId(null)}
          onChanged={() => {
            void load();
            onChanged();
          }}
        />
      )}
    </div>
  );
}
