'use client';

/**
 * TransactionTypeListView — VT-style master/detail view of every transaction
 * of a given type (PAY, REC, SIN, etc.).
 *
 *   ┌─────────────────────┬───────────────────────────────────────┐
 *   │ [Search PAY refs…]  │ PAY 001528 · 31 Mar 2026 ·  £150.00   │
 *   │                     │ Cully Cullen Expenses                 │
 *   │ + New PAY           │ ──────                                │
 *   │ ─────────           │ Account | Entry details | Debit | Cr  │
 *   │ PAY 001528  Cully…  │ Bank …    Cully expenses        150  │
 *   │ PAY 001527  DIGIT…  │ Suppl…    Cully expenses  150         │
 *   │ PAY 001526  GODA…   │                          ───  ────    │
 *   │ …                   │             Totals       150  150     │
 *   └─────────────────────┴───────────────────────────────────────┘
 *
 * Lives as a dynamic tab in the side rail (one per type). Reuses the
 * row-actions hook so right-click on a row delivers the full menu
 * (Edit / Duplicate / Change type / Audit history / Delete).
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, Search, Plus, ReceiptText, ShoppingCart, Wallet, BookOpenCheck, ArrowRightLeft } from 'lucide-react';
import { useTransactionRowActions } from './useTransactionRowActions';
import { AccountLink } from '../book/BookNavigationContext';
import type { Transaction, TransactionType } from '@/types/bookkeeping';

interface Props {
  bookId: string;
  type: TransactionType;
  /** Optional pre-selection. When set, the view tries to scroll/select this
   *  transaction on first render — used when the user clicks a ref elsewhere
   *  in the app and we want them to land directly on it. */
  initialTxnId?: string;
  /** Quick-launch into the input sheet pre-filled with this type. */
  onNewTransaction: () => void;
}

// Per-type config (label + icon + heading tint). Same colour language as
// the rail's New-transaction popout and the input-sheet type pills.
const TYPE_META: Record<TransactionType, { label: string; description: string; icon: typeof ReceiptText; tone: string }> = {
  PAY: { label: 'PAY', description: 'Bank payments',     icon: Wallet,         tone: 'bg-emerald-50 text-emerald-600' },
  CHQ: { label: 'CHQ', description: 'Cheque payments',   icon: Wallet,         tone: 'bg-emerald-50 text-emerald-600' },
  REC: { label: 'REC', description: 'Bank receipts',     icon: Wallet,         tone: 'bg-emerald-50 text-emerald-600' },
  TRF: { label: 'TRF', description: 'Bank transfers',    icon: Wallet,         tone: 'bg-emerald-50 text-emerald-600' },
  SIN: { label: 'SIN', description: 'Sales invoices',    icon: ReceiptText,    tone: 'bg-blue-50 text-blue-600'       },
  SCR: { label: 'SCR', description: 'Sales credit notes', icon: ReceiptText,   tone: 'bg-blue-50 text-blue-600'       },
  PIN: { label: 'PIN', description: 'Purchase invoices', icon: ShoppingCart,   tone: 'bg-amber-50 text-amber-600'     },
  PCR: { label: 'PCR', description: 'Purchase credits',  icon: ShoppingCart,   tone: 'bg-amber-50 text-amber-600'     },
  JRN: { label: 'JRN', description: 'Journal entries',   icon: BookOpenCheck,  tone: 'bg-violet-50 text-violet-600'   },
  RJN: { label: 'RJN', description: 'Reversing journals', icon: BookOpenCheck, tone: 'bg-violet-50 text-violet-600'   },
};

function formatDateUk(iso: string): string {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  if (!y || !m || !d) return iso;
  return `${d}/${m}/${y}`;
}
function fmt(n: number): string {
  return Number(n).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function TransactionTypeListView({ bookId, type, initialTxnId, onNewTransaction }: Props) {
  const meta = TYPE_META[type];
  const Icon = meta.icon;

  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(initialTxnId ?? null);
  const [refreshKey, setRefreshKey] = useState(0);

  // Book-level VAT info for the row-actions Edit modal's late-entry detection.
  const [bookVatInfo, setBookVatInfo] = useState<{ vatRegistered: boolean; vatLockDate: string | null }>({
    vatRegistered: false, vatLockDate: null,
  });
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/bookkeeping/books/${bookId}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (cancelled || !d?.book) return;
        setBookVatInfo({
          vatRegistered: Boolean(d.book.vat_registered),
          vatLockDate: d.book.vat_lock_date ?? null,
        });
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [bookId]);

  // ── Load all transactions of this type ────────────────────────────────────
  const load = useCallback(async () => {
    setLoading(true);
    try {
      // We pull a generous batch — the user usually wants to see everything
      // for a given type. 500 covers years of activity for most clients.
      const r = await fetch(`/api/bookkeeping/books/${bookId}/transactions?type=${type}&limit=500`);
      if (r.ok) {
        const d = await r.json();
        const txns = (d.transactions ?? []) as Transaction[];
        setTransactions(txns);
        // Auto-select if nothing chosen yet — pick initial id if present,
        // otherwise the most recent (first in the desc-ordered list).
        if (!selectedId || !txns.some(t => t.id === selectedId)) {
          if (initialTxnId && txns.some(t => t.id === initialTxnId)) {
            setSelectedId(initialTxnId);
          } else if (txns.length > 0) {
            setSelectedId(txns[0].id);
          }
        }
      }
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookId, type, refreshKey]);
  useEffect(() => { void load(); }, [load]);

  // ── Row actions for the master list ───────────────────────────────────────
  const rowActions = useTransactionRowActions({
    bookId,
    vatRegistered: bookVatInfo.vatRegistered,
    vatLockDate: bookVatInfo.vatLockDate,
    onChanged: () => setRefreshKey(k => k + 1),
  });

  // ── Filter / search ───────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return transactions;
    return transactions.filter(t => {
      const hay = [t.ref_no, t.details ?? '', t.payee_text ?? '', formatDateUk(t.date)].join(' ').toLowerCase();
      return hay.includes(q);
    });
  }, [transactions, search]);

  const selected = useMemo(
    () => transactions.find(t => t.id === selectedId) ?? null,
    [transactions, selectedId],
  );

  // ── Double-entry totals for the selected transaction ──────────────────────
  const totals = useMemo(() => {
    if (!selected?.splits) return { dr: 0, cr: 0 };
    const dr = selected.splits.reduce((s, x) => s + Number(x.debit || 0), 0);
    const cr = selected.splits.reduce((s, x) => s + Number(x.credit || 0), 0);
    return { dr, cr };
  }, [selected]);

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="flex gap-3 items-start">
      {/* ── Left panel: type list ──────────────────────────────────────────── */}
      <div
        className="w-72 shrink-0 rounded-xl border border-slate-200 bg-white shadow-sm flex flex-col"
        style={{ height: 'calc(100vh - 14rem)' }}
      >
        <div className="px-3 pt-3 pb-2 border-b border-slate-100">
          <div className="flex items-center gap-2 mb-2">
            <div className={`w-7 h-7 rounded-lg flex items-center justify-center ${meta.tone}`}>
              <Icon size={14} />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="text-sm font-semibold text-slate-900 truncate">{meta.label}</h3>
              <p className="text-[10px] text-slate-500 truncate">{meta.description}</p>
            </div>
            <span className="text-[10px] uppercase tracking-wide font-semibold text-slate-400 tabular-nums shrink-0">
              {transactions.length}
            </span>
          </div>
          <div className="relative">
            <Search size={11} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder={`Search ${meta.label} refs / payees…`}
              className="w-full text-xs pl-7 pr-3 py-1.5 border border-slate-200 rounded focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-300"
            />
          </div>
        </div>

        {/* + New entry — shortcut to the input sheet pre-filled with this type */}
        <button
          type="button"
          onClick={onNewTransaction}
          className="flex items-center gap-2 px-3 py-2 text-xs text-indigo-700 hover:bg-indigo-50 border-b border-slate-100 transition-colors"
        >
          <Plus size={12} /> <span className="font-medium">New {meta.label}</span>
        </button>

        {/* List */}
        <div className="flex-1 overflow-y-auto min-h-0">
          {loading ? (
            <div className="flex items-center justify-center py-6 text-xs text-slate-400">
              <Loader2 size={12} className="animate-spin mr-1.5" /> Loading…
            </div>
          ) : filtered.length === 0 ? (
            <p className="text-xs text-slate-400 italic px-3 py-3">
              {transactions.length === 0
                ? `No ${meta.label} transactions yet — post your first one via the action toolbar.`
                : `No ${meta.label} match "${search}".`}
            </p>
          ) : (
            <ul className="divide-y divide-slate-50">
              {filtered.map(t => {
                const active = t.id === selectedId;
                const rp = rowActions.rowProps(t);
                return (
                  <li key={t.id} {...rp}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(t.id)}
                      className={`w-full text-left px-3 py-2 transition-colors ${
                        active
                          ? 'bg-indigo-50 text-indigo-900'
                          : 'hover:bg-slate-50 text-slate-700'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className={`font-mono text-[11px] font-semibold shrink-0 ${active ? 'text-indigo-700' : 'text-slate-700'}`}>
                          {t.ref_no}
                        </span>
                        <span className="text-[10px] text-slate-500 tabular-nums shrink-0">
                          {formatDateUk(t.date)}
                        </span>
                      </div>
                      <div className="text-xs mt-0.5 truncate">
                        {t.payee_text ?? t.details ?? <span className="text-slate-400 italic">No details</span>}
                      </div>
                      <div className="text-[10px] text-slate-500 tabular-nums mt-0.5">
                        £{fmt(Number(t.total))}
                        {Number(t.vat_total) > 0 && (
                          <> · <span className="text-slate-400">VAT £{fmt(Number(t.vat_total))}</span></>
                        )}
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      {/* ── Right panel: detail ────────────────────────────────────────────── */}
      <div
        className="flex-1 min-w-0 rounded-xl border border-slate-200 bg-white shadow-sm flex flex-col"
        style={{ height: 'calc(100vh - 14rem)' }}
      >
        {!selected ? (
          <div className="p-10 text-center text-sm text-slate-400">
            Pick a {meta.label} on the left to see its double-entry breakdown.
          </div>
        ) : (
          <>
            {/* Header strip — ref, date, payee, total */}
            <div className="px-4 py-2.5 border-b border-slate-100 bg-slate-50/40">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-mono text-sm font-semibold text-slate-900">{selected.ref_no}</span>
                <span className="text-slate-300">·</span>
                <span className="text-xs text-slate-600 tabular-nums">{formatDateUk(selected.date)}</span>
                <span className="text-slate-300">·</span>
                <span className="text-xs text-slate-700 truncate">{selected.payee_text ?? selected.details ?? '—'}</span>
                <div className="flex-1" />
                <span className="text-xs font-semibold text-slate-900 tabular-nums">£{fmt(Number(selected.total))}</span>
                {Number(selected.vat_total) > 0 && (
                  <span className="text-[10px] text-slate-500 tabular-nums">(VAT £{fmt(Number(selected.vat_total))})</span>
                )}
              </div>
              {selected.details && selected.details !== selected.payee_text && (
                <p className="text-[11px] text-slate-500 mt-1 truncate">{selected.details}</p>
              )}
            </div>

            {/* Double-entry table */}
            <div className="flex-1 overflow-y-auto min-h-0 p-4">
              <table className="w-full text-sm border-collapse">
                <thead className="text-[10px] uppercase tracking-wide font-semibold text-slate-500 border-b border-slate-200">
                  <tr>
                    <th className="px-3 py-2 text-left">Account</th>
                    <th className="px-3 py-2 text-left">Entry details</th>
                    <th className="px-3 py-2 text-right w-28">Debit</th>
                    <th className="px-3 py-2 text-right w-28">Credit</th>
                  </tr>
                </thead>
                <tbody>
                  {(selected.splits ?? []).map(s => (
                    <tr key={s.id} className="border-b border-slate-100">
                      <td className="px-3 py-1.5"><AccountLink account={s.account ?? null} /></td>
                      <td className="px-3 py-1.5 text-slate-700">{s.entry_details ?? ''}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-slate-900">{s.debit > 0 ? fmt(s.debit) : ''}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-rose-700">{s.credit > 0 ? fmt(s.credit) : ''}</td>
                    </tr>
                  ))}
                  <tr className="border-t-2 border-slate-300 bg-slate-50/70">
                    <td className="px-3 py-1.5 text-[10px] uppercase tracking-wide font-semibold text-slate-500" colSpan={2}>Totals</td>
                    <td className="px-3 py-1.5 text-right tabular-nums font-semibold text-slate-900">{fmt(totals.dr)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums font-semibold text-slate-900">{fmt(totals.cr)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {/* Right-click row-actions menus (modals/drawer rendered once) */}
      {rowActions.menus}
    </div>
  );
}
