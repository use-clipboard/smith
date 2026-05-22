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
import { Loader2, Trash2, Sparkles } from 'lucide-react';
import KeyInformationCard from './KeyInformationCard';
import QuickActionsCard from './QuickActionsCard';
import GettingStartedCard from './GettingStartedCard';
import type { Book, Transaction } from '@/types/bookkeeping';

interface Props {
  /** Full book record so KeyInformationCard can read VAT / template / etc. */
  book: Book;
  /** Called when the user wants to delete a row — bubbled up so the page can confirm + refresh. */
  onDelete?: (txnId: string) => Promise<void>;
  /** Quick action — switch the workspace to the Input tab. */
  onAddTransaction: () => void;
  /** Re-render trigger — bumped by the parent when a new transaction is posted. */
  refreshKey?: number;
}

function formatDateUk(iso: string): string {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  if (!y || !m || !d) return iso;
  return `${d}/${m}/${y}`;
}

export default function BookHomeTab({ book, onDelete, onAddTransaction, refreshKey }: Props) {
  const bookId = book.id;
  const vatRegistered = book.vat_registered;
  const [recent, setRecent] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);

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

  async function handleDelete(txId: string) {
    if (!onDelete) return;
    await onDelete(txId);
    void refresh();
  }

  return (
    <div className="space-y-3">
      {/* Top section — narrow left (Key Info + Quick Actions) + wide right (Getting Started) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-3">
        <div className="lg:col-span-5 flex flex-col gap-3">
          <KeyInformationCard book={book} refreshKey={refreshKey} />
          <QuickActionsCard onAddTransaction={onAddTransaction} />
        </div>
        <div className="lg:col-span-7">
          <GettingStartedCard />
        </div>
      </div>

      {/* Recent transactions feed */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <h3 className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide">
            Recent transactions
          </h3>
          <span className="text-[11px] text-gray-400">
            {loading ? '…' : `${recent.length} shown`}
          </span>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-10 text-gray-400 text-sm">
            <Loader2 size={14} className="animate-spin mr-2" /> Loading…
          </div>
        ) : recent.length === 0 ? (
          <div className="text-center py-10 px-6 border border-slate-200 rounded-xl bg-white shadow-sm">
            <div className="inline-flex items-center justify-center w-10 h-10 rounded-lg bg-indigo-50 text-indigo-600 mb-2">
              <Sparkles size={16} />
            </div>
            <p className="text-sm font-medium text-slate-900 mb-0.5">No transactions yet</p>
            <p className="text-xs text-slate-500">Use the action toolbar above to post your first one — try <span className="font-semibold text-indigo-700">PAY</span>.</p>
          </div>
        ) : (
          <div className="border border-gray-200 rounded-lg overflow-hidden bg-white">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-[10px] font-semibold text-gray-500 uppercase tracking-wide">
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
                {recent.map(t => {
                  const analysis = t.splits?.find(s => s.account_id !== t.primary_account_id);
                  return (
                    <tr key={t.id} className="border-t border-gray-100 hover:bg-indigo-50/30">
                      <td className="px-2 py-1.5 text-gray-700 tabular-nums">{formatDateUk(t.date)}</td>
                      <td className="px-2 py-1.5 text-indigo-700 text-xs">{t.ref_no}</td>
                      <td className="px-2 py-1.5 text-gray-900 truncate max-w-[280px]">{t.details ?? ''}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{Number(t.total).toFixed(2)}</td>
                      {vatRegistered && (
                        <td className="px-2 py-1.5 text-right tabular-nums text-gray-500">
                          {Number(t.vat_total) > 0 ? Number(t.vat_total).toFixed(2) : ''}
                        </td>
                      )}
                      <td className="px-2 py-1.5 text-indigo-700 truncate max-w-[220px]">
                        {t.primary_account ? `${t.primary_account.ledger ?? ''}: ${t.primary_account.name}` : ''}
                      </td>
                      <td className="px-2 py-1.5 text-indigo-700 truncate max-w-[220px]">
                        {analysis?.account ? `${analysis.account.ledger ?? ''}: ${analysis.account.name}` : ''}
                      </td>
                      <td className="px-2 py-1.5">
                        {onDelete && (
                          <button
                            type="button"
                            onClick={() => void handleDelete(t.id)}
                            aria-label={`Delete ${t.ref_no}`}
                            className="p-1 rounded text-gray-400 hover:text-red-600 hover:bg-red-50"
                          >
                            <Trash2 size={12} />
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
