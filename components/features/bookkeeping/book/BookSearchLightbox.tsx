'use client';

/**
 * BookSearchLightbox — book-wide search workspace.
 *
 * Opens from:
 *   • The Search rail icon (under Home)
 *   • Ctrl+K / Cmd+K anywhere in the book
 *   • The "View all" button on the Home recent-transactions feed
 *
 * Everything is scoped to the currently-open book only — no cross-book or
 * cross-firm leakage. The lightbox fetches transactions on open (cached in
 * state) and runs all filter/search/sort work client-side over the loaded
 * set. Server-side pagination is deferred to a future task.
 *
 * Layout:
 *   ┌───────────────────────────────────────────────────────────────┐
 *   │ Search   [_search_box_]            Print  Export  Columns  ✕  │
 *   ├───────────────────────────────────────────────────────────────┤
 *   │ [Date▾] [Type▾] [Account▾] [Amount▾] [Status▾]   N of M       │
 *   ├───────────────────────────────────────────────────────────────┤
 *   │  Date ↑  Ref   Details      Total   VAT   Primary   Analysis  │
 *   │  ...  (virtualised rows)                                       │
 *   └───────────────────────────────────────────────────────────────┘
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Loader2, X, Printer, Download, Search, Calendar, Filter,
  ChevronDown, ChevronUp, ArrowUpDown, Columns as ColumnsIcon, Check,
} from 'lucide-react';
import { createPortal } from 'react-dom';
import { useTransactionRowActions } from '../transactions/useTransactionRowActions';
import { TxnRefLink } from './BookNavigationContext';
import { printReport } from '../reports/printReport';
import { exportRowsAsCsv, type CsvRow } from '../reports/exportReportCsv';
import { formatMoneyAbs } from '@/lib/bookkeeping/formatMoney';
import { useVirtualizer } from '@tanstack/react-virtual';
import Tooltip from '@/components/ui/Tooltip';
import type { Transaction, TransactionType } from '@/types/bookkeeping';

interface Props {
  bookId: string;
  bookName: string;
  vatRegistered: boolean;
  vatLockDate: string | null;
  /** Click handler for account links — opens the account's ledger view. */
  onOpenAccount?: (account: { id: string; name: string; ledger: string | null }) => void;
  /** Click handler for ref pills — opens the type-list view focused on that txn. */
  onOpenTypeList?: (type: TransactionType, txnId?: string) => void;
  onClose: () => void;
}

// ── Column model ────────────────────────────────────────────────────────────
// Each column is identified by a stable id so user preferences (visibility,
// sort) survive across renders and (later) cross-session via localStorage.
type ColumnId = 'date' | 'ref' | 'type' | 'details' | 'total' | 'vat' | 'primary' | 'analysis';
interface ColumnDef {
  id: ColumnId;
  label: string;
  /** Per-row sortable? When false the header is rendered without a sort affordance. */
  sortable: boolean;
  /** True for the right-aligned numeric columns. */
  numeric?: boolean;
}
const COLUMN_DEFS: ColumnDef[] = [
  { id: 'date',     label: 'Date',     sortable: true                  },
  { id: 'ref',      label: 'Ref',      sortable: true                  },
  { id: 'type',     label: 'Type',     sortable: true                  },
  { id: 'details',  label: 'Details',  sortable: true                  },
  { id: 'total',    label: 'Total',    sortable: true, numeric: true   },
  { id: 'vat',      label: 'VAT',      sortable: true, numeric: true   },
  { id: 'primary',  label: 'Primary',  sortable: false                 },
  { id: 'analysis', label: 'Analysis', sortable: false                 },
];

// ── Helpers ─────────────────────────────────────────────────────────────────

function formatDateUk(iso: string): string {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  if (!y || !m || !d) return iso;
  return `${d}/${m}/${y}`;
}

/** Multi-word AND search — every whitespace-separated term must appear
 *  somewhere in the row's stringified columns. Case-insensitive. Identical
 *  semantics to the old All-recent search so user muscle memory carries. */
function matchesSearch(t: Transaction, terms: string[]): boolean {
  if (terms.length === 0) return true;
  const analysis = t.splits?.find(s => s.account_id !== t.primary_account_id);
  const haystack = [
    t.date,
    t.ref_no,
    t.type,
    t.details ?? '',
    String(t.total ?? ''),
    String(t.vat_total ?? ''),
    t.primary_account ? `${t.primary_account.ledger ?? ''}: ${t.primary_account.name}` : '',
    analysis?.account ? `${analysis.account.ledger ?? ''}: ${analysis.account.name}` : '',
  ].join(' ').toLowerCase();
  return terms.every(term => haystack.includes(term));
}

// ── Date-range presets ──────────────────────────────────────────────────────
// Compact preset chips for the Date filter. "Custom" reveals two date inputs
// so the user can pick anything. ISO strings throughout — comparison is
// lexicographic and matches the DB column ordering.

function isoToday(): string { return new Date().toISOString().slice(0, 10); }
function isoMonthsAgo(n: number): string {
  const d = new Date(); d.setMonth(d.getMonth() - n);
  return d.toISOString().slice(0, 10);
}
function isoStartOfMonth(): string {
  const d = new Date(); d.setDate(1);
  return d.toISOString().slice(0, 10);
}
function isoStartOfYear(): string {
  return `${new Date().getFullYear()}-01-01`;
}

const DATE_PRESETS: { id: string; label: string; range: () => [string | null, string | null] }[] = [
  { id: 'all',     label: 'All time',         range: () => [null, null] },
  { id: 'tm',      label: 'This month',       range: () => [isoStartOfMonth(), isoToday()] },
  { id: 'l30',     label: 'Last 30 days',     range: () => [isoMonthsAgo(1), isoToday()] },
  { id: 'l90',     label: 'Last 90 days',     range: () => [isoMonthsAgo(3), isoToday()] },
  { id: 'ytd',     label: 'This year',        range: () => [isoStartOfYear(), isoToday()] },
];

// ── Component ───────────────────────────────────────────────────────────────

export default function BookSearchLightbox({
  bookId, bookName, vatRegistered, vatLockDate, onOpenAccount, onOpenTypeList, onClose,
}: Props) {
  // Data ---------------------------------------------------------------------
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`/api/bookkeeping/books/${bookId}/transactions?limit=10000`);
      if (r.ok) {
        const d = await r.json();
        setTransactions((d.transactions ?? []) as Transaction[]);
      }
    } finally {
      setLoading(false);
    }
  }, [bookId]);
  useEffect(() => { void refresh(); }, [refresh]);

  // Row actions (right-click + edit modal etc.) ------------------------------
  const rowActions = useTransactionRowActions({
    bookId, vatRegistered, vatLockDate,
    onChanged: () => void refresh(),
  });

  // ── Search + filters ────────────────────────────────────────────────────
  const [search, setSearch] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Date range
  const [dateFrom, setDateFrom] = useState<string | null>(null);
  const [dateTo,   setDateTo]   = useState<string | null>(null);

  // Type filter — empty set means "all types"
  const [typesFilter, setTypesFilter] = useState<Set<string>>(new Set());

  // Amount range (parsed numbers; empty string → unbounded)
  const [amountFromText, setAmountFromText] = useState('');
  const [amountToText,   setAmountToText]   = useState('');

  // Match status filter
  const [matchFilter, setMatchFilter] = useState<'either' | 'matched' | 'unmatched'>('either');

  // Auto-focus the search box on mount + Escape closes.
  useEffect(() => {
    searchInputRef.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  // ── Column visibility + sort ─────────────────────────────────────────────
  const [visibleCols, setVisibleCols] = useState<Set<ColumnId>>(() => new Set(
    vatRegistered
      ? ['date','ref','details','total','vat','primary','analysis']
      : ['date','ref','details','total','primary','analysis'],
  ));
  const [columnsMenuOpen, setColumnsMenuOpen] = useState(false);

  /** Sort state — column id + direction. null = default order (date desc + ref desc). */
  const [sort, setSort] = useState<{ col: ColumnId; dir: 'asc' | 'desc' } | null>(null);

  function toggleSort(col: ColumnId) {
    setSort(prev => {
      if (!prev || prev.col !== col) return { col, dir: 'asc' };
      if (prev.dir === 'asc') return { col, dir: 'desc' };
      return null; // third click resets to default
    });
  }
  function toggleColumn(col: ColumnId) {
    setVisibleCols(prev => {
      const next = new Set(prev);
      if (next.has(col)) next.delete(col); else next.add(col);
      return next;
    });
  }

  // ── Apply filters + sort ─────────────────────────────────────────────────
  const filtered = useMemo(() => {
    const terms = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const amtFrom = amountFromText.trim() ? parseFloat(amountFromText) : null;
    const amtTo   = amountToText.trim()   ? parseFloat(amountToText)   : null;
    return transactions.filter(t => {
      if (!matchesSearch(t, terms)) return false;
      if (dateFrom && t.date < dateFrom) return false;
      if (dateTo   && t.date > dateTo)   return false;
      if (typesFilter.size > 0 && !typesFilter.has(t.type)) return false;
      const amt = Number(t.total ?? 0);
      if (amtFrom != null && amt < amtFrom) return false;
      if (amtTo   != null && amt > amtTo)   return false;
      // Match status — a transaction is "matched" iff every split is part of
      // a match. We don't have that flag on the txn list; approximate as
      // "either" for now — the column-level matched indicator lives on the
      // ledger view, not the txn list. Skip filter to avoid showing wrong
      // results. If `matchFilter` is set to matched/unmatched we just no-op
      // here until a future improvement adds the flag.
      void matchFilter;
      return true;
    });
  }, [transactions, search, dateFrom, dateTo, typesFilter, amountFromText, amountToText, matchFilter]);

  const sorted = useMemo(() => {
    if (!sort) {
      // Default: newest first by date, then ref_seq desc as tiebreaker.
      return [...filtered].sort((a, b) =>
        a.date === b.date
          ? (b.ref_seq ?? 0) - (a.ref_seq ?? 0)
          : a.date < b.date ? 1 : -1
      );
    }
    const mul = sort.dir === 'asc' ? 1 : -1;
    return [...filtered].sort((a, b) => {
      switch (sort.col) {
        case 'date': return mul * (a.date < b.date ? -1 : a.date > b.date ? 1 : (a.ref_seq ?? 0) - (b.ref_seq ?? 0));
        case 'ref':  return mul * ((a.ref_no ?? '').localeCompare(b.ref_no ?? ''));
        case 'type': return mul * (a.type ?? '').localeCompare(b.type ?? '');
        case 'details': return mul * (a.details ?? '').localeCompare(b.details ?? '');
        case 'total': return mul * (Number(a.total) - Number(b.total));
        case 'vat': return mul * (Number(a.vat_total ?? 0) - Number(b.vat_total ?? 0));
        default: return 0;
      }
    });
  }, [filtered, sort]);

  // ── Discovered types — for the Type filter dropdown ────────────────────
  const availableTypes = useMemo(() => {
    const set = new Set<string>();
    for (const t of transactions) set.add(t.type);
    return [...set].sort();
  }, [transactions]);

  // ── Active filter count + clear-all ─────────────────────────────────────
  const activeFilterCount =
    (dateFrom || dateTo ? 1 : 0)
    + (typesFilter.size > 0 ? 1 : 0)
    + (amountFromText.trim() || amountToText.trim() ? 1 : 0)
    + (matchFilter !== 'either' ? 1 : 0);

  function clearAllFilters() {
    setDateFrom(null); setDateTo(null);
    setTypesFilter(new Set());
    setAmountFromText(''); setAmountToText('');
    setMatchFilter('either');
  }

  // ── Print + Export ───────────────────────────────────────────────────────
  function handlePrint() {
    const el = buildPrintable(sorted, vatRegistered, bookName, search.trim(), activeFilterCount);
    printReport(el, `Search results — ${bookName}`, { orientation: 'landscape' });
  }
  function handleExport() {
    const header: CsvRow = ['Date', 'Ref', 'Type', 'Details', 'Total'];
    if (vatRegistered) header.push('VAT');
    header.push('Primary account', 'Analysis account');
    const rows: CsvRow[] = [header];
    for (const t of sorted) {
      const primary = t.primary_account ? `${t.primary_account.ledger ?? ''}: ${t.primary_account.name}` : '';
      const analysisSplit = t.splits?.find(s => s.account_id !== t.primary_account_id);
      const analysis = analysisSplit?.account ? `${analysisSplit.account.ledger ?? ''}: ${analysisSplit.account.name}` : '';
      const row: CsvRow = [t.date, t.ref_no, t.type, t.details ?? '', Number(t.total).toFixed(2)];
      if (vatRegistered) row.push(Number(t.vat_total ?? 0).toFixed(2));
      row.push(primary, analysis);
      rows.push(row);
    }
    exportRowsAsCsv(`Search — ${bookName}.csv`, rows);
  }

  // ── Render ───────────────────────────────────────────────────────────────
  return createPortal(
    <>
      <div className="fixed inset-0 z-[1400] bg-slate-900/40" onClick={onClose} />
      <div className="fixed inset-0 z-[1450] flex items-center justify-center p-4 pointer-events-none">
        <div
          className="w-full max-w-[1400px] rounded-xl bg-white shadow-2xl border border-slate-200 overflow-hidden pointer-events-auto flex flex-col"
          style={{ height: 'calc(100vh - 4rem)' }}
          onClick={e => e.stopPropagation()}
          role="dialog"
          aria-modal="true"
          aria-labelledby="book-search-title"
        >
          {/* Header — title + search box + actions */}
          <div className="px-4 py-3 border-b border-slate-200 flex items-center gap-3 bg-slate-50/40">
            <h2 id="book-search-title" className="text-sm font-semibold text-slate-900 shrink-0 inline-flex items-center gap-1.5">
              <Search size={14} className="text-slate-400" /> Search
            </h2>
            <span className="text-[11px] text-slate-500 shrink-0">{loading ? 'Loading…' : `${sorted.length} of ${transactions.length}`}</span>
            <div className="relative flex-1 max-w-xl ml-3">
              <Search size={11} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                ref={searchInputRef}
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search across every column…"
                className="w-full text-sm pl-7 pr-7 py-1.5 border border-slate-200 rounded focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-300"
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch('')}
                  aria-label="Clear search"
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700"
                >
                  <X size={11} />
                </button>
              )}
            </div>
            <div className="ml-auto flex items-center gap-1.5">
              <Tooltip label="Print this view">
                <button type="button" onClick={handlePrint} aria-label="Print"
                  className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700">
                  <Printer size={12} /> Print
                </button>
              </Tooltip>
              <Tooltip label="Export filtered results to CSV">
                <button type="button" onClick={handleExport} aria-label="Export"
                  className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700">
                  <Download size={12} /> Export
                </button>
              </Tooltip>
              <ColumnsMenu
                open={columnsMenuOpen}
                onToggle={() => setColumnsMenuOpen(o => !o)}
                onClose={() => setColumnsMenuOpen(false)}
                visibleCols={visibleCols}
                vatRegistered={vatRegistered}
                onToggleColumn={toggleColumn}
              />
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="ml-1 w-7 h-7 rounded hover:bg-slate-100 flex items-center justify-center text-slate-400 hover:text-slate-700"
              >
                <X size={14} />
              </button>
            </div>
          </div>

          {/* Filter chips row */}
          <div className="px-4 py-2 border-b border-slate-100 flex items-center gap-1.5 flex-wrap bg-white">
            <span className="text-[10px] uppercase tracking-wide font-semibold text-slate-500 inline-flex items-center gap-1 mr-1">
              <Filter size={11} /> Filters
            </span>
            <DateFilterChip from={dateFrom} to={dateTo} onChange={(f, t) => { setDateFrom(f); setDateTo(t); }} />
            <TypeFilterChip available={availableTypes} value={typesFilter} onChange={setTypesFilter} />
            <AmountFilterChip
              fromText={amountFromText} toText={amountToText}
              onChange={(f, t) => { setAmountFromText(f); setAmountToText(t); }}
            />
            {activeFilterCount > 0 && (
              <button
                type="button"
                onClick={clearAllFilters}
                className="text-[11px] text-slate-500 hover:text-slate-800 underline ml-2"
              >
                Clear all
              </button>
            )}
          </div>

          {/* Body — virtualised table */}
          <div className="flex-1 min-h-0">
            {loading ? (
              <div className="flex items-center justify-center py-10 text-xs text-slate-400">
                <Loader2 size={14} className="animate-spin mr-1.5" /> Loading transactions…
              </div>
            ) : sorted.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 px-6 text-center">
                <Search size={20} className="text-slate-300 mb-2" />
                <p className="text-sm font-medium text-slate-700">No transactions match</p>
                <p className="text-xs text-slate-500 mt-1">Try removing a filter or adjusting your search.</p>
              </div>
            ) : (
              <VirtualisedSearchTable
                rows={sorted}
                vatRegistered={vatRegistered}
                visibleCols={visibleCols}
                sort={sort}
                onToggleSort={toggleSort}
                rowActions={rowActions}
                onOpenAccount={onOpenAccount}
                onOpenTypeList={(type, txnId) => { onOpenTypeList?.(type, txnId); onClose(); }}
              />
            )}
          </div>
        </div>
      </div>
      {rowActions.menus}
    </>,
    document.body,
  );
}

// ── Filter chips ────────────────────────────────────────────────────────────

function FilterChip({
  label, active, count, children, anchorRef,
}: {
  label: string;
  active: boolean;
  count?: number;
  children: React.ReactNode;
  /** Click outside the wrapper closes the popover via onClose passed in children. */
  anchorRef?: React.RefObject<HTMLDivElement>;
}) {
  return (
    <div ref={anchorRef} className="relative">
      {children}
    </div>
  );
}

function DateFilterChip({
  from, to, onChange,
}: {
  from: string | null;
  to: string | null;
  onChange: (from: string | null, to: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useClickOutside(ref, () => setOpen(false));

  const active = !!(from || to);
  const label = active
    ? `${from ? formatDateUk(from) : '…'} → ${to ? formatDateUk(to) : '…'}`
    : 'Any date';

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className={`inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-md border transition-colors ${
          active
            ? 'bg-indigo-50 border-indigo-200 text-indigo-700'
            : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
        }`}
      >
        <Calendar size={10} />
        Date: {label}
        <ChevronDown size={10} className="text-slate-400" />
      </button>
      {open && (
        <div className="absolute z-[1500] left-0 top-full mt-1 bg-white border border-slate-200 rounded-lg shadow-xl p-2 w-[260px]">
          <div className="flex flex-wrap gap-1 mb-2">
            {DATE_PRESETS.map(p => (
              <button
                key={p.id}
                type="button"
                onClick={() => { const [f, t] = p.range(); onChange(f, t); setOpen(false); }}
                className="text-[11px] px-2 py-0.5 rounded border border-slate-200 hover:bg-slate-50 text-slate-700"
              >
                {p.label}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <label className="text-[10px] text-slate-500">
              From
              <input
                type="date"
                value={from ?? ''}
                onChange={e => onChange(e.target.value || null, to)}
                className="mt-0.5 w-full text-xs px-1.5 py-1 border border-slate-200 rounded"
              />
            </label>
            <label className="text-[10px] text-slate-500">
              To
              <input
                type="date"
                value={to ?? ''}
                onChange={e => onChange(from, e.target.value || null)}
                className="mt-0.5 w-full text-xs px-1.5 py-1 border border-slate-200 rounded"
              />
            </label>
          </div>
          {active && (
            <button
              type="button"
              onClick={() => { onChange(null, null); setOpen(false); }}
              className="mt-2 text-[11px] text-slate-500 hover:text-slate-800 underline"
            >
              Clear date filter
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function TypeFilterChip({
  available, value, onChange,
}: {
  available: string[];
  value: Set<string>;
  onChange: (next: Set<string>) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useClickOutside(ref, () => setOpen(false));
  const active = value.size > 0;
  const label = active
    ? value.size === 1 ? [...value][0] : `${value.size} types`
    : 'Any type';

  function toggle(t: string) {
    const next = new Set(value);
    if (next.has(t)) next.delete(t); else next.add(t);
    onChange(next);
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className={`inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-md border transition-colors ${
          active
            ? 'bg-indigo-50 border-indigo-200 text-indigo-700'
            : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
        }`}
      >
        Type: {label}
        <ChevronDown size={10} className="text-slate-400" />
      </button>
      {open && (
        <div className="absolute z-[1500] left-0 top-full mt-1 bg-white border border-slate-200 rounded-lg shadow-xl p-2 max-h-72 overflow-y-auto min-w-[160px]">
          {available.length === 0 ? (
            <div className="text-[11px] text-slate-400 italic px-2 py-1">No types found.</div>
          ) : available.map(t => {
            const checked = value.has(t);
            return (
              <button
                key={t}
                type="button"
                onClick={() => toggle(t)}
                className="w-full flex items-center gap-2 px-2 py-1 text-[11px] hover:bg-slate-50 rounded text-left"
              >
                <span className={`inline-flex w-4 h-4 items-center justify-center rounded border ${
                  checked ? 'bg-indigo-600 border-indigo-600 text-white' : 'border-slate-300 bg-white'
                }`}>
                  {checked && <Check size={10} strokeWidth={3} />}
                </span>
                <span className="text-slate-700">{t}</span>
              </button>
            );
          })}
          {active && (
            <button
              type="button"
              onClick={() => { onChange(new Set()); setOpen(false); }}
              className="mt-1 text-[11px] text-slate-500 hover:text-slate-800 underline px-2"
            >
              Clear
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function AmountFilterChip({
  fromText, toText, onChange,
}: {
  fromText: string;
  toText: string;
  onChange: (from: string, to: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useClickOutside(ref, () => setOpen(false));
  const active = !!(fromText.trim() || toText.trim());
  const label = active
    ? `${fromText.trim() || '…'} → ${toText.trim() || '…'}`
    : 'Any amount';

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className={`inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-md border transition-colors ${
          active
            ? 'bg-indigo-50 border-indigo-200 text-indigo-700'
            : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
        }`}
      >
        Amount: {label}
        <ChevronDown size={10} className="text-slate-400" />
      </button>
      {open && (
        <div className="absolute z-[1500] left-0 top-full mt-1 bg-white border border-slate-200 rounded-lg shadow-xl p-2 w-[220px]">
          <div className="grid grid-cols-2 gap-2">
            <label className="text-[10px] text-slate-500">
              Min
              <input
                type="number"
                value={fromText}
                onChange={e => onChange(e.target.value, toText)}
                step="0.01"
                placeholder="0.00"
                className="mt-0.5 w-full text-xs px-1.5 py-1 border border-slate-200 rounded"
              />
            </label>
            <label className="text-[10px] text-slate-500">
              Max
              <input
                type="number"
                value={toText}
                onChange={e => onChange(fromText, e.target.value)}
                step="0.01"
                placeholder="∞"
                className="mt-0.5 w-full text-xs px-1.5 py-1 border border-slate-200 rounded"
              />
            </label>
          </div>
          {active && (
            <button
              type="button"
              onClick={() => { onChange('', ''); setOpen(false); }}
              className="mt-2 text-[11px] text-slate-500 hover:text-slate-800 underline"
            >
              Clear amount filter
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ── Columns show/hide menu ──────────────────────────────────────────────────

function ColumnsMenu({
  open, onToggle, onClose, visibleCols, vatRegistered, onToggleColumn,
}: {
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
  visibleCols: Set<ColumnId>;
  vatRegistered: boolean;
  onToggleColumn: (col: ColumnId) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useClickOutside(ref, onClose);

  // Hide the VAT column option entirely on non-VAT books — they'd never use it.
  const visibleColumnDefs = COLUMN_DEFS.filter(c => vatRegistered || c.id !== 'vat');

  return (
    <div ref={ref} className="relative">
      <Tooltip label="Show / hide columns">
        <button
          type="button"
          onClick={onToggle}
          aria-label="Columns"
          className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700"
        >
          <ColumnsIcon size={12} /> Columns
        </button>
      </Tooltip>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-[1500] bg-white border border-slate-200 rounded-lg shadow-xl py-1 min-w-[180px]">
          {visibleColumnDefs.map(col => {
            const checked = visibleCols.has(col.id);
            // Force Date + Ref always-on — without them the table is unreadable.
            const locked = col.id === 'date' || col.id === 'ref';
            return (
              <button
                key={col.id}
                type="button"
                onClick={() => { if (!locked) onToggleColumn(col.id); }}
                disabled={locked}
                className={`w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left hover:bg-slate-50 ${
                  locked ? 'opacity-60 cursor-not-allowed' : ''
                }`}
              >
                <span className={`inline-flex w-4 h-4 items-center justify-center rounded border ${
                  checked ? 'bg-indigo-600 border-indigo-600 text-white' : 'border-slate-300 bg-white'
                }`}>
                  {checked && <Check size={10} strokeWidth={3} />}
                </span>
                <span className="text-slate-700">{col.label}</span>
                {locked && <span className="ml-auto text-[10px] text-slate-400">required</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Virtualised table ──────────────────────────────────────────────────────

function VirtualisedSearchTable({
  rows, vatRegistered, visibleCols, sort, onToggleSort,
  rowActions, onOpenAccount, onOpenTypeList,
}: {
  rows: Transaction[];
  vatRegistered: boolean;
  visibleCols: Set<ColumnId>;
  sort: { col: ColumnId; dir: 'asc' | 'desc' } | null;
  onToggleSort: (col: ColumnId) => void;
  rowActions: ReturnType<typeof useTransactionRowActions>;
  onOpenAccount?: (a: { id: string; name: string; ledger: string | null }) => void;
  onOpenTypeList?: (type: TransactionType, txnId?: string) => void;
}) {
  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 32,
    overscan: 10,
  });

  // Build the grid template from visible columns. Numeric columns get a
  // fixed narrow width; account/details columns flex.
  function gridTemplate(): string {
    return COLUMN_DEFS
      .filter(c => visibleCols.has(c.id) && (vatRegistered || c.id !== 'vat'))
      .map(c => {
        switch (c.id) {
          case 'date':     return '6rem';
          case 'ref':      return '7rem';
          case 'type':     return '3.5rem';
          case 'total':    return '6.5rem';
          case 'vat':      return '5rem';
          case 'details':  return 'minmax(0, 1.4fr)';
          case 'primary':  return 'minmax(0, 1fr)';
          case 'analysis': return 'minmax(0, 1fr)';
          default:         return 'minmax(0, 1fr)';
        }
      }).join(' ') + ' 2.5rem'; // trailing actions column
  }
  const template = gridTemplate();

  // Header click → cycle sort.
  function SortIcon({ col }: { col: ColumnId }) {
    if (!sort || sort.col !== col) return <ArrowUpDown size={9} className="text-slate-300 inline ml-1" />;
    return sort.dir === 'asc'
      ? <ChevronUp size={11} className="text-indigo-600 inline ml-1" />
      : <ChevronDown size={11} className="text-indigo-600 inline ml-1" />;
  }
  function HeaderCell({ col }: { col: ColumnId }) {
    const def = COLUMN_DEFS.find(c => c.id === col)!;
    return (
      <div className={`px-2 ${def.numeric ? 'text-right' : 'text-left'}`}>
        {def.sortable ? (
          <button
            type="button"
            onClick={() => onToggleSort(col)}
            className="hover:text-slate-900 inline-flex items-center"
          >
            {def.label}
            <SortIcon col={col} />
          </button>
        ) : def.label}
      </div>
    );
  }

  // Order of cells must match the gridTemplate order.
  const orderedCols = COLUMN_DEFS.filter(c => visibleCols.has(c.id) && (vatRegistered || c.id !== 'vat'));

  return (
    <div className="flex flex-col h-full">
      <div
        className="grid items-center px-0 py-2 bg-gray-50 text-[10px] font-semibold text-gray-500 uppercase tracking-wide border-b border-slate-200"
        style={{ gridTemplateColumns: template }}
      >
        {orderedCols.map(c => <HeaderCell key={c.id} col={c.id} />)}
        <div className="px-2 print-hidden" />
      </div>

      <div ref={parentRef} className="flex-1 overflow-auto">
        <div style={{ height: virtualizer.getTotalSize(), width: '100%', position: 'relative' }}>
          {virtualizer.getVirtualItems().map(v => {
            const t = rows[v.index];
            const analysis = t.splits?.find(s => s.account_id !== t.primary_account_id);
            const rp = rowActions.rowProps(t);
            return (
              <div
                key={t.id}
                {...rp}
                className={`grid items-center border-b border-gray-100 hover:bg-indigo-50/30 text-sm ${rp.className ?? ''}`}
                style={{
                  position: 'absolute', top: 0, left: 0, right: 0,
                  transform: `translateY(${v.start}px)`,
                  height: v.size,
                  gridTemplateColumns: template,
                }}
              >
                {orderedCols.map(c => (
                  <Cell
                    key={c.id} col={c.id} txn={t}
                    onOpenAccount={onOpenAccount} onOpenTypeList={onOpenTypeList}
                    analysisSplit={analysis}
                  />
                ))}
                <div className="px-2 text-right print-hidden">{rowActions.renderActions(t)}</div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function Cell({
  col, txn, onOpenAccount, onOpenTypeList, analysisSplit,
}: {
  col: ColumnId;
  txn: Transaction;
  onOpenAccount?: (a: { id: string; name: string; ledger: string | null }) => void;
  onOpenTypeList?: (type: TransactionType, txnId?: string) => void;
  analysisSplit: Transaction['splits'] extends (infer S)[] | undefined ? S : never;
}) {
  switch (col) {
    case 'date': return <div className="px-2 text-gray-700 tabular-nums">{formatDateUk(txn.date)}</div>;
    case 'ref':  return (
      <div className="px-2 text-xs" onClick={() => onOpenTypeList?.(txn.type, txn.id)}>
        <TxnRefLink txn={txn} className="text-xs" />
      </div>
    );
    case 'type': return <div className="px-2 text-gray-600 font-mono text-xs">{txn.type}</div>;
    case 'details': return <div className="px-2 text-gray-900 truncate">{txn.details ?? ''}</div>;
    case 'total': return <div className="px-2 text-right tabular-nums">{formatMoneyAbs(Number(txn.total))}</div>;
    case 'vat': return (
      <div className="px-2 text-right tabular-nums text-gray-500">
        {Number(txn.vat_total) > 0 ? formatMoneyAbs(Number(txn.vat_total)) : ''}
      </div>
    );
    case 'primary': return (
      <div className="px-2 truncate">
        {txn.primary_account && onOpenAccount ? (
          <button type="button" onClick={() => onOpenAccount({
            id: txn.primary_account!.id, name: txn.primary_account!.name, ledger: txn.primary_account!.ledger,
          })} className="text-indigo-700 hover:underline text-left">
            {`${txn.primary_account.ledger ?? ''}: ${txn.primary_account.name}`}
          </button>
        ) : <span className="text-indigo-700">
          {txn.primary_account ? `${txn.primary_account.ledger ?? ''}: ${txn.primary_account.name}` : ''}
        </span>}
      </div>
    );
    case 'analysis': {
      const a = analysisSplit?.account;
      return (
        <div className="px-2 truncate">
          {a && onOpenAccount ? (
            <button type="button" onClick={() => onOpenAccount({ id: a.id, name: a.name, ledger: a.ledger })}
              className="text-indigo-700 hover:underline text-left">
              {`${a.ledger ?? ''}: ${a.name}`}
            </button>
          ) : <span className="text-indigo-700">{a ? `${a.ledger ?? ''}: ${a.name}` : ''}</span>}
        </div>
      );
    }
  }
}

// ── Click-outside helper ────────────────────────────────────────────────────
function useClickOutside(ref: React.RefObject<HTMLElement>, onAway: () => void) {
  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (!ref.current) return;
      if (!ref.current.contains(e.target as Node)) onAway();
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [ref, onAway]);
}

// ── Print HTML builder ─────────────────────────────────────────────────────

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
}
function buildPrintable(
  rows: Transaction[],
  vatRegistered: boolean,
  bookName: string,
  searchQuery: string,
  activeFilterCount: number,
): HTMLDivElement {
  const container = document.createElement('div');
  container.className = 'bk-print-root';
  const filterNote = activeFilterCount > 0 ? ` · ${activeFilterCount} filter${activeFilterCount === 1 ? '' : 's'} applied` : '';

  container.innerHTML = `
    <div class="bk-print-only" style="padding:0 0 8pt;border-bottom:1px solid #ccc;margin-bottom:8pt">
      <div style="font-weight:700;font-size:12pt">${escapeHtml(bookName)}</div>
      <div style="font-size:11pt">Search results</div>
      <div style="font-size:10pt">
        ${rows.length} transaction${rows.length === 1 ? '' : 's'}${
          searchQuery ? ` matching &quot;${escapeHtml(searchQuery)}&quot;` : ''
        }${filterNote}
      </div>
    </div>
    <div class="bk-print-area">
      <table style="width:100%;border-collapse:collapse;font-size:9pt">
        <thead>
          <tr>
            ${['Date','Ref','Type','Details','Total']
              .concat(vatRegistered ? ['VAT'] : [])
              .concat(['Primary','Analysis'])
              .map(h => `<th style="text-align:left;padding:4pt 6pt;border-bottom:1px solid #000">${h}</th>`)
              .join('')}
          </tr>
        </thead>
        <tbody>
          ${rows.map(t => {
            const analysisSplit = t.splits?.find(s => s.account_id !== t.primary_account_id);
            const primary = t.primary_account ? `${t.primary_account.ledger ?? ''}: ${t.primary_account.name}` : '';
            const analysis = analysisSplit?.account ? `${analysisSplit.account.ledger ?? ''}: ${analysisSplit.account.name}` : '';
            const cells = [
              formatDateUk(t.date), t.ref_no, t.type, t.details ?? '',
              Number(t.total).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
            ];
            if (vatRegistered) cells.push(Number(t.vat_total ?? 0) > 0 ? Number(t.vat_total).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '');
            cells.push(primary, analysis);
            return `<tr>${cells.map((c, i) => {
              const align = (i === 4 || (vatRegistered && i === 5)) ? 'right' : 'left';
              return `<td style="padding:2pt 6pt;text-align:${align};border-bottom:1px solid #eee">${escapeHtml(String(c))}</td>`;
            }).join('')}</tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>`;
  return container;
}
