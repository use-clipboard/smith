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

import { useEffect, useState, useCallback, useMemo } from 'react';
import { Loader2, X, Printer, Download, Search } from 'lucide-react';
import KeyInformationCard from './KeyInformationCard';
import QuickActionsCard from './QuickActionsCard';
import BookWhiteboardCard from './BookWhiteboardCard';
import { useTransactionRowActions } from '../transactions/useTransactionRowActions';
import { printReport } from '../reports/printReport';
import { exportRowsAsCsv, type CsvRow } from '../reports/exportReportCsv';
import VirtualisedTxnList from './VirtualisedTxnList';
import { TxnRefLink } from './BookNavigationContext';
import { formatMoneyAbs } from '@/lib/bookkeeping/formatMoney';
import type { Book, Transaction, TransactionType } from '@/types/bookkeeping';

interface Props {
  /** Full book record so KeyInformationCard can read VAT / template / etc. */
  book: Book;
  /** Called when the user wants to delete a row — bubbled up so the page can confirm + refresh. */
  onDelete?: (txnId: string) => Promise<void>;
  /** Quick action — switch the workspace to the Input tab. */
  onAddTransaction: () => void;
  /** Switches the workspace to the Import tab — wired into the Import Data
   *  Quick Action button. Was a side-rail button until the user asked us
   *  to move it here (bulk imports are deliberate, not day-to-day). */
  onImport?: () => void;
  /** Opens the book-wide search lightbox — wired into the "View all" link
   *  on the recent-transactions feed. The lightbox replaces the local
   *  All-recent modal so search/filter/sort all live in one place. */
  onOpenSearch?: () => void;
  /** Re-render trigger — bumped by the parent when a new transaction is posted. */
  refreshKey?: number;
  /** Click handler on an account name in a Primary / Analysis cell. Opens the
   *  matching ledger drill-down tab in the rail. */
  onOpenAccount?: (account: { id: string; name: string; ledger: string | null }) => void;
  /** Click handler on a transaction reference (e.g. PAY 000001). Opens the
   *  type-list rail tab focused on that transaction. */
  onOpenTypeList?: (type: TransactionType, txnId?: string) => void;
  /** Current user — passed to the book whiteboard for note attribution and
   *  the own-note UI affordances. */
  currentUserId: string;
  currentUserName: string | null;
}

function formatDateUk(iso: string): string {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  if (!y || !m || !d) return iso;
  return `${d}/${m}/${y}`;
}

export default function BookHomeTab({ book, onDelete, onAddTransaction, onImport, onOpenSearch, refreshKey, onOpenAccount, onOpenTypeList, currentUserId, currentUserName }: Props) {
  const bookId = book.id;
  const vatRegistered = book.vat_registered;
  const [recent, setRecent] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAllModal, setShowAllModal] = useState(false);
  /** Free-text search across every visible column in the All-recent modal. */
  const [allTxnSearch, setAllTxnSearch] = useState('');

  /** AND-style multi-word search: every whitespace-separated term must
   *  appear somewhere in the row's stringified columns. Case-insensitive.
   *  Memoised — recomputes only when the data or the query changes. */
  const filteredAllTxns = useMemo(() => filterTxns(recent, allTxnSearch), [recent, allTxnSearch]);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      // No effective cap — request the maximum the API allows. Bulk-imported
      // books happily run to several thousand rows and the user expects to
      // see all of them in the Home recent feed (the list itself is virtualised
      // by the scroll container, so render cost stays flat).
      const r = await fetch(`/api/bookkeeping/books/${bookId}/transactions?limit=10000`);
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
          <QuickActionsCard onAddTransaction={onAddTransaction} onImport={onImport} />
          <KeyInformationCard book={book} refreshKey={refreshKey} className="flex-1 min-h-0" />
        </div>
        <div className="lg:col-span-7 min-h-0">
          <BookWhiteboardCard
            bookId={bookId}
            bookName={book.name}
            currentUserId={currentUserId}
            currentUserName={currentUserName}
            className="h-full"
          />
        </div>
      </div>

      {/* Recent transactions — fixed height showing ~5 rows, scrollable
          internally. "View all" opens a fullscreen modal with the full list.
          Header has generous top padding so any sticky notes spilling down
          from the whiteboard cover the empty space above it, not the title. */}
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm flex flex-col" style={{ height: 'calc(5 * 2.5rem + 5.5rem)' }}>
        <div className="px-3 pt-7 pb-2 border-b border-slate-100 flex items-center gap-2 shrink-0">
          <h3 className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide">
            Recent transactions
          </h3>
          <span className="ml-auto text-[11px] text-gray-400">
            {loading ? '…' : `${Math.min(recent.length, 5)} of ${recent.length} shown`}
          </span>
          {recent.length > 5 && (
            <button
              type="button"
              onClick={() => {
                // If the parent has wired the lightbox, hand off to it —
                // that gives the user filters / sort / column controls
                // instead of the basic All-recent modal below. Fallback to
                // the local modal so this still works in isolation (e.g.
                // tests that mount BookHomeTab directly).
                if (onOpenSearch) onOpenSearch();
                else setShowAllModal(true);
              }}
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
              <div className="px-4 py-3 border-b border-slate-200 flex items-center gap-2 bg-slate-50/40 print-hidden">
                <h2 className="text-sm font-semibold text-slate-900">All recent transactions</h2>
                <span className="text-[11px] text-slate-500">
                  {allTxnSearch.trim()
                    ? `${filteredAllTxns.length} of ${recent.length} match`
                    : `${recent.length} total`}
                </span>
                {/* Search — filters across Date, Ref, Type, Details, Total,
                    VAT, Primary and Analysis. Case-insensitive substring
                    match; multiple words are AND-ed so the user can refine
                    quickly (e.g. "amazon pay" finds Amazon PAY entries). */}
                <div className="relative ml-3 flex-1 max-w-xs">
                  <Search size={11} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    value={allTxnSearch}
                    onChange={e => setAllTxnSearch(e.target.value)}
                    placeholder="Search across every column…"
                    className="w-full text-xs pl-7 pr-7 py-1.5 border border-slate-200 rounded focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-300"
                  />
                  {allTxnSearch && (
                    <button
                      type="button"
                      onClick={() => setAllTxnSearch('')}
                      aria-label="Clear search"
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700"
                    >
                      <X size={11} />
                    </button>
                  )}
                </div>
                <div className="ml-auto flex items-center gap-1.5">
                  {/* Print — opens the table in a popup window and triggers
                      the browser's print dialog. Uses the same util as the
                      TB/P&L/BS reports for consistency. */}
                  <button
                    type="button"
                    onClick={() => {
                      // Build the print HTML on-the-fly from the filtered
                      // data — we can't pull rows from the live DOM any more
                      // because the modal virtualises them (only ~30 are
                      // actually mounted at any given time). Generating a
                      // fresh detached element from the data array means
                      // print works for the full filtered set regardless
                      // of what's currently in the viewport.
                      const el = buildPrintableTxnList(
                        filteredAllTxns,
                        vatRegistered,
                        book.name ?? 'Book',
                        allTxnSearch.trim(),
                      );
                      printReport(
                        el,
                        `Recent transactions — ${book.name ?? 'Book'}`,
                        { orientation: 'landscape' },
                      );
                    }}
                    className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700"
                  >
                    <Printer size={12} /> Print
                  </button>
                  {/* Export — flat CSV with one row per transaction (header
                      fields only — splits beyond primary/analysis would need
                      a separate splits export). */}
                  <button
                    type="button"
                    onClick={() => {
                      const header: CsvRow = ['Date', 'Ref', 'Type', 'Details', 'Total'];
                      if (vatRegistered) header.push('VAT');
                      header.push('Primary account', 'Analysis account');
                      const rows: CsvRow[] = [header];
                      // Export respects the active search so the user can
                      // narrow the file to e.g. "all Amazon expenses".
                      for (const t of filteredAllTxns) {
                        const primary = t.primary_account
                          ? `${t.primary_account.ledger ?? ''}: ${t.primary_account.name}`
                          : '';
                        const analysisSplit = t.splits?.find(s => s.account_id !== t.primary_account_id);
                        const analysis = analysisSplit?.account
                          ? `${analysisSplit.account.ledger ?? ''}: ${analysisSplit.account.name}`
                          : '';
                        const row: CsvRow = [
                          t.date,
                          t.ref_no,
                          t.type,
                          t.details ?? '',
                          Number(t.total).toFixed(2),
                        ];
                        if (vatRegistered) row.push(Number(t.vat_total ?? 0).toFixed(2));
                        row.push(primary, analysis);
                        rows.push(row);
                      }
                      exportRowsAsCsv(`Recent transactions — ${book.name ?? 'Book'}.csv`, rows);
                    }}
                    className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700"
                  >
                    <Download size={12} /> Export
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowAllModal(false)}
                    aria-label="Close"
                    className="ml-1 text-slate-400 hover:text-slate-700"
                  >
                    <X size={16} />
                  </button>
                </div>
              </div>
              {/* Virtualised scroller — only renders the ~30 rows currently
                  in view, so a 2,500-row list stays as snappy as a 5-row
                  one. The Print button builds its own HTML from the data
                  (see buildPrintableTxnList) rather than scraping the DOM,
                  because virtualised rows aren't all mounted at once. */}
              <div className="flex-1 min-h-0">
                <VirtualisedTxnList
                  rows={filteredAllTxns}
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

// ── Print builder ───────────────────────────────────────────────────────────
// Constructs a detached HTMLDivElement containing the full transaction list
// formatted for the print popup. We build from data (not DOM) because the
// modal's VirtualisedTxnList only ever has ~30 rows mounted, so we can't
// scrape the visible elements for print. The element returned is passed to
// printReport(), which copies it into a new browser window for printing.
function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;',
  }[c]!));
}
function buildPrintableTxnList(
  rows: Transaction[],
  vatRegistered: boolean,
  bookName: string,
  searchQuery: string,
): HTMLDivElement {
  const container = document.createElement('div');
  container.className = 'bk-print-root';

  const headerHtml = `
    <div class="bk-print-only" style="padding:0 0 8pt;border-bottom:1px solid #ccc;margin-bottom:8pt">
      <div style="font-weight:700;font-size:12pt">${escapeHtml(bookName)}</div>
      <div style="font-size:11pt">Recent transactions</div>
      <div style="font-size:10pt">
        ${rows.length} transaction${rows.length === 1 ? '' : 's'}${
        searchQuery ? ` matching &quot;${escapeHtml(searchQuery)}&quot;` : ''
      }
      </div>
    </div>`;

  const headerCells = ['Date', 'Ref', 'Type', 'Details', vatRegistered ? 'Total' : 'Amount']
    .concat(vatRegistered ? ['VAT'] : [])
    .concat(['Primary', 'Analysis'])
    .map(h => `<th style="text-align:left;padding:4pt 6pt;border-bottom:1px solid #000">${h}</th>`)
    .join('');

  const bodyRows = rows.map(t => {
    const analysisSplit = t.splits?.find(s => s.account_id !== t.primary_account_id);
    const primary = t.primary_account ? `${t.primary_account.ledger ?? ''}: ${t.primary_account.name}` : '';
    const analysis = analysisSplit?.account ? `${analysisSplit.account.ledger ?? ''}: ${analysisSplit.account.name}` : '';
    const cells = [
      formatDateUk(t.date),
      t.ref_no,
      t.type,
      t.details ?? '',
      Number(t.total).toFixed(2),
    ];
    if (vatRegistered) cells.push(Number(t.vat_total ?? 0) > 0 ? Number(t.vat_total).toFixed(2) : '');
    cells.push(primary, analysis);
    return `<tr>${cells.map((c, i) => {
      const align = (i === 4 || (vatRegistered && i === 5)) ? 'right' : 'left';
      return `<td style="padding:2pt 6pt;text-align:${align};border-bottom:1px solid #eee">${escapeHtml(String(c))}</td>`;
    }).join('')}</tr>`;
  }).join('');

  container.innerHTML = `
    ${headerHtml}
    <div class="bk-print-area">
      <table style="width:100%;border-collapse:collapse;font-size:9pt">
        <thead>${headerCells ? `<tr>${headerCells}</tr>` : ''}</thead>
        <tbody>${bodyRows}</tbody>
      </table>
    </div>`;
  return container;
}

// ── Free-text search ────────────────────────────────────────────────────────
// Builds a single concatenated string from every column visible on the
// transactions table (Date, Ref, Type, Details, Total, VAT, Primary,
// Analysis) and matches against ALL whitespace-separated terms in the
// query. Case-insensitive substring AND — typing "amazon pay" finds rows
// where BOTH words appear somewhere (handy when the user wants to narrow
// down quickly). Empty query → returns every row.
function filterTxns(rows: Transaction[], query: string): Transaction[] {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return rows;
  return rows.filter(t => {
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
  });
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
          <th className="px-2 py-1.5 w-10 print-hidden" />
        </tr>
      </thead>
      <tbody>
        {rows.map(t => {
          const analysis = t.splits?.find(s => s.account_id !== t.primary_account_id);
          const rp = rowActions.rowProps(t);
          return (
            <tr key={t.id} {...rp} className={`border-t border-gray-100 hover:bg-indigo-50/30 ${rp.className}`}>
              <td className="px-2 py-1.5 text-gray-700 tabular-nums">{formatDateUk(t.date)}</td>
              <td
                className="px-2 py-1.5 text-xs"
                onClick={() => onOpenTypeList?.(t.type, t.id)}
              >
                {/* Same T-account hover popover as the modal's virtualised
                    list and every ledger view in the app. */}
                <TxnRefLink txn={t} />
              </td>
              <td className="px-2 py-1.5 text-gray-900 truncate max-w-[280px]">{t.details ?? ''}</td>
              <td className="px-2 py-1.5 text-right tabular-nums">{formatMoneyAbs(Number(t.total))}</td>
              {vatRegistered && (
                <td className="px-2 py-1.5 text-right tabular-nums text-gray-500">
                  {Number(t.vat_total) > 0 ? formatMoneyAbs(Number(t.vat_total)) : ''}
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
              <td className="px-2 py-1.5 text-right print-hidden">{rowActions.renderActions(t)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
