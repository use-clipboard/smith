'use client';

/**
 * BookHomeTab — the dense VT-style Home view inside an open book.
 *
 * Layout (Phase 3A.5-ii):
 *   ┌─────────────────────────────────────────────┐
 *   │ Key Information (4 sub-tabs)  │ Getting     │
 *   ├───────────────────────────────┤ Started     │
 *   │ Quick Actions (6 buttons)     │ (help)      │
 *   ├───────────────────────────────┴─────────────┤
 *   │ Recent transactions feed (full width)       │
 *   └─────────────────────────────────────────────┘
 */

import { useEffect, useState, useCallback } from 'react';
import { Loader2, Sparkles, X } from 'lucide-react';
import KeyInformationCard from './KeyInformationCard';
import QuickActionsCard from './QuickActionsCard';
import GettingStartedCard from './GettingStartedCard';
import { useTransactionRowActions } from '../transactions/useTransactionRowActions';
import type { Book, Transaction, TransactionType } from '@/types/bookkeeping';

interface Props {
  /** Full book record so KeyInformationCard can read VAT / template / etc. */
  book: Book;
  /** Called when the user wants to delete a row — bubbled up so the page can confirm + refresh. */
  onDelete?: (txnId: string) => Promise<void>;
  /** Quick action — switch the workspace to the Input tab. */
  onAddTransaction: () => void;
  /** Re-render trigger — bumped by the parent when a new transaction is posted. */
  refreshKey?: number;
  /** Click handler on an account name in a Primary / Analysis cell. Opens the
   *  matching ledger drill-down tab in the rail. */
  onOpenAccount?: (account: { id: string; name: string; ledger: string | null }) => void;
  /** Click handler on a transaction reference (e.g. PAY 000001). Opens the
   *  type-list rail tab focused on that transaction. */
  onOpenTypeList?: (type: TransactionType, txnId?: string) => void;
}

function formatDateUk(iso: string): string {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  if (!y || !m || !d) return iso;
  return `${d}/${m}/${y}`;
}

export default function BookHomeTab({ book, onDelete, onAddTransaction, refreshKey, onOpenAccount, onOpenTypeList }: Props) {
  const bookId = book.id;
  const vatRegistered = book.vat_registered;
  const [recent, setRecent] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAllModal, setShowAllModal] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`/api/bookkeeping/books/${bookId}/transactions?limit=100`);
      if (r.ok) {
        const d = await r.json();
        setRecent((d.transactions ?? []) as Transaction[]);
      }
    } finally {
      setLoading(false);
    }
  }, [bookId]);

  useEffect(() => { void refresh(); }, [refresh, refreshKey]);

  // Row actions — edit / duplicate / change-type / audit / delete via the
  // hover strip + ⋯ menu + right-click context menu.
  const rowActions = useTransactionRowActions({
    bookId,
    vatRegistered,
    vatLockDate: book.vat_lock_date ?? null,
    onChanged: () => void refresh(),
  });

  async function handleDelete(txId: string) {
    if (!onDelete) return;
    await onDelete(txId);
    void refresh();
  }

  return (
    <div className="space-y-3">
      {/* Top section — narrow left (Key Info + Quick Actions stacked) + wide
          right (Getting Started). All cards share a fixed total height so the
          Recent Transactions feed sits prominently below them, not off-screen. */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-3" style={{ height: 'calc(100vh - 32rem)', minHeight: '20rem' }}>
        <div className="lg:col-span-5 flex flex-col gap-3 min-h-0">
          {/* Quick Actions takes its natural compact height; Key Info fills the rest and scrolls. */}
          <QuickActionsCard onAddTransaction={onAddTransaction} />
          <KeyInformationCard book={book} refreshKey={refreshKey} className="flex-1 min-h-0" />
        </div>
        <div className="lg:col-span-7 min-h-0">
          <GettingStartedCard className="h-full" />
        </div>
      </div>

      {/* Recent transactions — fixed height showing ~5 rows, scrollable
          internally. "View all" opens a fullscreen modal with the full list. */}
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm flex flex-col" style={{ height: 'calc(5 * 2.5rem + 4rem)' }}>
        <div className="px-3 py-2 border-b border-slate-100 flex items-center gap-2 shrink-0">
          <h3 className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide">
            Recent transactions
          </h3>
          <span className="ml-auto text-[11px] text-gray-400">
            {loading ? '…' : `${Math.min(recent.length, 5)} of ${recent.length} shown`}
          </span>
          {recent.length > 5 && (
            <button
              type="button"
              onClick={() => setShowAllModal(true)}
              className="text-[11px] text-indigo-700 hover:underline font-medium"
            >
              View all →
            </button>
          )}
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-10 text-gray-400 text-sm">
            <Loader2 size={14} className="animate-spin mr-2" /> Loading…
          </div>
        ) : recent.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center px-6 min-h-0">
            <div className="inline-flex items-center justify-center w-10 h-10 rounded-lg bg-indigo-50 text-indigo-600 mb-2">
              <Sparkles size={16} />
            </div>
            <p className="text-sm font-medium text-slate-900 mb-0.5">No transactions yet</p>
            <p className="text-xs text-slate-500">Use the action toolbar above to post your first one — try <span className="font-semibold text-indigo-700">PAY</span>.</p>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto min-h-0">
            <RecentTxnTable
              rows={recent.slice(0, 5)}
              vatRegistered={vatRegistered}
              rowActions={rowActions}
              onOpenAccount={onOpenAccount}
              onOpenTypeList={onOpenTypeList}
            />
          </div>
        )}
      </div>

      {/* View-all modal — fullscreen-ish lightbox with the complete list. */}
      {showAllModal && (
        <>
          <div className="fixed inset-0 z-[1400] bg-slate-900/40" onClick={() => setShowAllModal(false)} />
          <div className="fixed inset-0 z-[1450] flex items-center justify-center p-4 pointer-events-none">
            <div
              className="w-full max-w-[1200px] rounded-xl bg-white shadow-2xl border border-slate-200 overflow-hidden pointer-events-auto flex flex-col"
              style={{ height: 'calc(100vh - 4rem)' }}
            >
              <div className="px-4 py-3 border-b border-slate-200 flex items-center gap-2 bg-slate-50/40">
                <h2 className="text-sm font-semibold text-slate-900">All recent transactions</h2>
                <span className="text-[11px] text-slate-500">{recent.length} total</span>
                <button
                  type="button"
                  onClick={() => setShowAllModal(false)}
                  aria-label="Close"
                  className="ml-auto text-slate-400 hover:text-slate-700"
                >
                  <X size={16} />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto min-h-0">
                <RecentTxnTable
                  rows={recent}
                  vatRegistered={vatRegistered}
                  rowActions={rowActions}
                  onOpenAccount={onOpenAccount}
                  onOpenTypeList={(type, txnId) => { onOpenTypeList?.(type, txnId); setShowAllModal(false); }}
                />
              </div>
            </div>
          </div>
        </>
      )}

      {rowActions.menus}
    </div>
  );
}

// ── Shared row table — used by both the inline 5-row view and the modal ─────
function RecentTxnTable({
  rows, vatRegistered, rowActions, onOpenAccount, onOpenTypeList,
}: {
  rows: Transaction[];
  vatRegistered: boolean;
  rowActions: ReturnType<typeof useTransactionRowActions>;
  onOpenAccount?: (account: { id: string; name: string; ledger: string | null }) => void;
  onOpenTypeList?: (type: TransactionType, txnId?: string) => void;
}) {
  return (
    <table className="w-full text-sm">
      <thead className="bg-gray-50 text-[10px] font-semibold text-gray-500 uppercase tracking-wide sticky top-0 z-10">
        <tr>
          <th className="px-2 py-1.5 text-left w-24">Date</th>
          <th className="px-2 py-1.5 text-left w-28">Ref</th>
          <th className="px-2 py-1.5 text-left">Details</th>
          <th className="px-2 py-1.5 text-right w-24">{vatRegistered ? 'Total' : 'Amount'}</th>
          {vatRegistered && <th className="px-2 py-1.5 text-right w-20">VAT</th>}
          <th className="px-2 py-1.5 text-left">Primary</th>
          <th className="px-2 py-1.5 text-left">Analysis</th>
          <th className="px-2 py-1.5 w-10" />
        </tr>
      </thead>
      <tbody>
        {rows.map(t => {
          const analysis = t.splits?.find(s => s.account_id !== t.primary_account_id);
          const rp = rowActions.rowProps(t);
          return (
            <tr key={t.id} {...rp} className={`border-t border-gray-100 hover:bg-indigo-50/30 ${rp.className}`}>
              <td className="px-2 py-1.5 text-gray-700 tabular-nums">{formatDateUk(t.date)}</td>
              <td className="px-2 py-1.5 text-xs">
                {onOpenTypeList ? (
                  <button
                    type="button"
                    onClick={() => onOpenTypeList(t.type, t.id)}
                    className="text-indigo-700 hover:underline hover:text-indigo-900 font-mono"
                  >
                    {t.ref_no}
                  </button>
                ) : (
                  <span className="text-indigo-700">{t.ref_no}</span>
                )}
              </td>
              <td className="px-2 py-1.5 text-gray-900 truncate max-w-[280px]">{t.details ?? ''}</td>
              <td className="px-2 py-1.5 text-right tabular-nums">{Number(t.total).toFixed(2)}</td>
              {vatRegistered && (
                <td className="px-2 py-1.5 text-right tabular-nums text-gray-500">
                  {Number(t.vat_total) > 0 ? Number(t.vat_total).toFixed(2) : ''}
                </td>
              )}
              <td className="px-2 py-1.5 truncate max-w-[220px]">
                {t.primary_account && onOpenAccount ? (
                  <button
                    type="button"
                    onClick={() => onOpenAccount({
                      id: t.primary_account!.id,
                      name: t.primary_account!.name,
                      ledger: t.primary_account!.ledger,
                    })}
                    className="text-indigo-700 hover:underline hover:text-indigo-900 text-left"
                  >
                    {`${t.primary_account.ledger ?? ''}: ${t.primary_account.name}`}
                  </button>
                ) : (
                  <span className="text-indigo-700">
                    {t.primary_account ? `${t.primary_account.ledger ?? ''}: ${t.primary_account.name}` : ''}
                  </span>
                )}
              </td>
              <td className="px-2 py-1.5 truncate max-w-[220px]">
                {analysis?.account && onOpenAccount ? (
                  <button
                    type="button"
                    onClick={() => onOpenAccount({
                      id: analysis.account!.id,
                      name: analysis.account!.name,
                      ledger: analysis.account!.ledger,
                    })}
                    className="text-indigo-700 hover:underline hover:text-indigo-900 text-left"
                  >
                    {`${analysis.account.ledger ?? ''}: ${analysis.account.name}`}
                  </button>
                ) : (
                  <span className="text-indigo-700">
                    {analysis?.account ? `${analysis.account.ledger ?? ''}: ${analysis.account.name}` : ''}
                  </span>
                )}
              </td>
              <td className="px-2 py-1.5 text-right">{rowActions.renderActions(t)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
