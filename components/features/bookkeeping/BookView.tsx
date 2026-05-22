'use client';

/**
 * BookView — the workspace shell for an open book.
 *
 * Layout (VT-style information density):
 *   ┌─────────────────────────────────────────────────────────────────┐
 *   │ name                                  [⚙ Settings] [< Books]    │
 *   ├─────────────────────────────────────────────────────────────────┤
 *   │ client · template · GBP · No VAT · created … · period lock …    │  ← compact metadata strip
 *   ├─────────────────────────────────────────────────────────────────┤
 *   │ [PAY] [CHQ] [REC] [TRF] | [SIN] [SCR] | [PIN] [PCR] | [JRN]     │  ← action toolbar
 *   ├─────────────────────────────────────────────────────────────────┤
 *   │ [Home] [Input sheet]                                            │  ← sub-tab strip
 *   ├─────────────────────────────────────────────────────────────────┤
 *   │                                                                  │
 *   │  (active tab content)                                            │
 *   │                                                                  │
 *   └─────────────────────────────────────────────────────────────────┘
 *
 * Sub-tabs preserve state — switching to Input sheet doesn't unmount the
 * Home tab's recent feed and vice versa. Visibility is toggled via display,
 * not conditional render. This is the "in-app windows" feel agreed in
 * Phase 0 (Option A).
 */

import { useEffect, useState, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  BookCopy, ChevronLeft, Loader2, Lock,
  Archive as ArchiveIcon,
} from 'lucide-react';
import ToolLayout from '@/components/ui/ToolLayout';
import BookHomeTab from './book/BookHomeTab';
import BookSettingsDrawer from './book/BookSettingsDrawer';
import BookSideRail from './book/BookSideRail';
import UniversalInputSheet from './input/UniversalInputSheet';
import JournalInputSheet from './input/JournalInputSheet';
import TrialBalanceTab from './reports/TrialBalanceTab';
import ProfitLossTab from './reports/ProfitLossTab';
import BalanceSheetTab from './reports/BalanceSheetTab';
import CashFlowTab from './reports/CashFlowTab';
import VatReturnTab from './reports/VatReturnTab';
import AccountLedgerTab from './reports/AccountLedgerTab';
import AccountsLedgerView from './ledger/AccountsLedgerView';
import { BOOK_TEMPLATE_LABEL, VAT_SCHEME_LABEL, type Book, type TransactionType } from '@/types/bookkeeping';

interface Props {
  bookId: string;
  userRole: 'admin' | 'staff';
}

// Fixed tabs are always present. Dynamic tabs (per-account ledger drill-downs)
// are added on demand by the TB and closeable.
type FixedTab = 'home' | 'input' | 'tb' | 'pnl' | 'bs' | 'cf' | 'vat' | 'customers' | 'suppliers';
interface DynamicLedgerTab {
  id: string;                  // unique tab id: `ledger:<accountId>`
  kind: 'ledger';
  accountId: string;
  accountName: string;
  accountLedger: string | null;
}
type AnyTab = FixedTab | string; // string for dynamic tabs (their id)

function formatDateUk(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

export default function BookView({ bookId, userRole }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const isAdmin = userRole === 'admin';

  const [book, setBook]       = useState<Book | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Tab state — initialised from ?tab=… so deep-links work.
  const initialTabParam = searchParams?.get('tab');
  const initialTab: FixedTab =
    initialTabParam === 'input' ? 'input' :
    initialTabParam === 'tb'    ? 'tb'    :
    initialTabParam === 'pnl'   ? 'pnl'   :
    initialTabParam === 'bs'    ? 'bs'    :
    initialTabParam === 'cf'    ? 'cf'    :
    initialTabParam === 'vat'   ? 'vat'   :
    initialTabParam === 'customers' ? 'customers' :
    initialTabParam === 'suppliers' ? 'suppliers' : 'home';
  const [tab, setTab] = useState<AnyTab>(initialTab);

  // Dynamic ledger tabs opened by the user drilling into accounts from the TB.
  const [ledgerTabs, setLedgerTabs] = useState<DynamicLedgerTab[]>([]);

  function openLedgerTab(account: { id: string; name: string; ledger: string | null }) {
    if (!account.id) return; // ignore ledger-row clicks (not yet wired)
    const tabId = `ledger:${account.id}`;
    setLedgerTabs(prev => {
      if (prev.some(t => t.id === tabId)) return prev;
      return [...prev, {
        id: tabId,
        kind: 'ledger',
        accountId: account.id,
        accountName: account.name,
        accountLedger: account.ledger,
      }];
    });
    setTab(tabId);
  }
  function closeLedgerTab(tabId: string) {
    setLedgerTabs(prev => prev.filter(t => t.id !== tabId));
    setTab(prev => (prev === tabId ? 'tb' : prev));
  }

  // Current input-sheet type. Controlled here so the toolbar can drive it
  // (clicking PAY/CHQ/REC/… switches the sheet without leaving the tab).
  const [inputType, setInputType] = useState<TransactionType>('PAY');

  // Bump this when a new transaction posts so the Home tab refreshes.
  const [refreshKey, setRefreshKey] = useState(0);
  const bumpRefresh = useCallback(() => setRefreshKey(k => k + 1), []);

  // ── Load ────────────────────────────────────────────────────────────────────
  const load = useCallback(() => {
    setLoading(true);
    fetch(`/api/bookkeeping/books/${bookId}`)
      .then(r => r.ok ? r.json() : Promise.reject(r))
      .then(d => setBook(d.book as Book))
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
  }, [bookId]);
  useEffect(() => { load(); }, [load]);

  // ── Delete handler used by Home tab's recent feed ──────────────────────────
  const handleDelete = useCallback(async (txId: string) => {
    if (!confirm('Delete this transaction? The reference number will not be reused.')) return;
    const r = await fetch(`/api/bookkeeping/books/${bookId}/transactions/${txId}`, { method: 'DELETE' });
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      alert(d.error ?? 'Delete failed');
      return;
    }
    bumpRefresh();
  }, [bookId, bumpRefresh]);

  // ── Action toolbar — switch to Input sheet and set the type ──────────────
  function handleAction(type: TransactionType) {
    setInputType(type);
    setTab('input');
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <ToolLayout title="Bookkeeping" icon={BookCopy} wide>
        <div className="flex items-center justify-center py-16 text-gray-400">
          <Loader2 size={16} className="animate-spin mr-2" /> Loading book…
        </div>
      </ToolLayout>
    );
  }

  if (notFound || !book) {
    return (
      <ToolLayout title="Bookkeeping" icon={BookCopy} wide>
        <div className="text-center py-16 text-sm text-gray-500">
          Book not found, or you don&apos;t have permission to view it.
          <div className="mt-4">
            <button onClick={() => router.push('/bookkeeping')} className="btn-secondary inline-flex items-center gap-2">
              <ChevronLeft size={14} /> Back to dashboard
            </button>
          </div>
        </div>
      </ToolLayout>
    );
  }

  const lockedForMe = book.admin_locked && !isAdmin;
  const clientLabel = book.client
    ? `${book.client.name}${book.client.client_ref ? ` (${book.client.client_ref})` : ''}`
    : 'Unallocated';

  return (
    <div className="p-4 max-w-[1600px] mx-auto flex gap-3 items-start">
      {/* ── Side rail ───────────────────────────────────────────────────── */}
      <BookSideRail
        activeTab={tab}
        onSelectTab={(id) => setTab(id as typeof tab)}
        onAction={handleAction}
        ledgerTabs={ledgerTabs.map(lt => ({
          id: lt.id,
          accountName: lt.accountName,
          accountLedger: lt.accountLedger,
        }))}
        onCloseLedgerTab={closeLedgerTab}
        onOpenSettings={() => setSettingsOpen(true)}
        disabled={lockedForMe || book.archived}
        className="sticky top-4 self-start"
      />

      {/* ── Main column ──────────────────────────────────────────────────── */}
      <div className="flex-1 min-w-0">
        {/* Header card */}
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm mb-3">
          <div className="p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center shrink-0">
              <BookCopy size={18} />
            </div>
            <div className="flex-1 min-w-0">
              <h1 className="text-base font-semibold text-slate-900 truncate leading-tight">{book.name}</h1>
              <div className="text-[11px] text-slate-500 flex items-center gap-1.5 flex-wrap mt-0.5">
                <span>Client:</span>
                <span className="font-medium text-slate-700">{clientLabel}</span>
                <span className="text-slate-300">·</span>
                <span>Template:</span>
                <span className="font-medium text-slate-700">{BOOK_TEMPLATE_LABEL[book.template_type]}</span>
                <span className="text-slate-300">·</span>
                <span className="font-medium text-slate-700">{book.base_currency}</span>
                <span className="text-slate-300">·</span>
                {book.vat_registered ? (
                  <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-100">
                    VAT{book.vat_scheme ? ` · ${VAT_SCHEME_LABEL[book.vat_scheme]}` : ''}
                  </span>
                ) : (
                  <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-slate-50 text-slate-600 border border-slate-100">
                    Non-VAT
                  </span>
                )}
                {book.vat_number && (
                  <>
                    <span className="text-slate-300">·</span>
                    <span className="text-slate-600">{book.vat_number}</span>
                  </>
                )}
                {book.period_lock_date && (
                  <>
                    <span className="text-slate-300">·</span>
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-50 text-amber-700 border border-amber-100">
                      <Lock size={9} /> Locked through {formatDateUk(book.period_lock_date)}
                    </span>
                  </>
                )}
              </div>
            </div>
            {book.admin_locked && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-amber-50 text-amber-700 border border-amber-100">
                <Lock size={10} /> Locked
              </span>
            )}
            {book.archived && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-slate-50 text-slate-600 border border-slate-200">
                <ArchiveIcon size={10} /> Archived
              </span>
            )}
            <button
              onClick={() => router.push('/bookkeeping')}
              className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-slate-200 hover:border-indigo-200 bg-white hover:bg-indigo-50 text-slate-700 hover:text-indigo-700 transition-colors"
            >
              <ChevronLeft size={13} /> Books
            </button>
          </div>
        </div>

        {/* ── Tab content — kept mounted, toggled via display ─────────────── */}
        <div>
        <div hidden={tab !== 'home'}>
          <BookHomeTab
            book={book}
            onDelete={handleDelete}
            onAddTransaction={() => { setInputType('PAY'); setTab('input'); }}
            refreshKey={refreshKey}
          />
        </div>
        <div hidden={tab !== 'input'}>
          {(inputType === 'JRN' || inputType === 'RJN') ? (
            <JournalInputSheet
              bookId={bookId}
              vatRegistered={book.vat_registered}
              type={inputType}
              onTypeChange={setInputType}
              onPosted={bumpRefresh}
            />
          ) : (
            <UniversalInputSheet
              bookId={bookId}
              vatRegistered={book.vat_registered}
              vatLockDate={book.vat_lock_date}
              type={inputType}
              onTypeChange={setInputType}
              onPosted={bumpRefresh}
            />
          )}
        </div>
        <div hidden={tab !== 'tb'}>
          <TrialBalanceTab bookId={bookId} onOpenAccount={openLedgerTab} />
        </div>
        <div hidden={tab !== 'pnl'}>
          <ProfitLossTab bookId={bookId} onOpenAccount={openLedgerTab} />
        </div>
        <div hidden={tab !== 'bs'}>
          <BalanceSheetTab bookId={bookId} onOpenAccount={openLedgerTab} />
        </div>
        <div hidden={tab !== 'cf'}>
          <CashFlowTab bookId={bookId} />
        </div>
        <div hidden={tab !== 'vat'}>
          <VatReturnTab bookId={bookId} isAdmin={isAdmin} />
        </div>
        <div hidden={tab !== 'customers'}>
          <AccountsLedgerView bookId={bookId} ledger="Customers" />
        </div>
        <div hidden={tab !== 'suppliers'}>
          <AccountsLedgerView bookId={bookId} ledger="Suppliers" />
        </div>
        {ledgerTabs.map(lt => (
          <div key={lt.id} hidden={tab !== lt.id}>
            {lt.accountLedger ? (
              <AccountsLedgerView
                bookId={bookId}
                ledger={lt.accountLedger}
                initialAccountId={lt.accountId}
              />
            ) : (
              <AccountLedgerTab
                bookId={bookId}
                accountId={lt.accountId}
                accountName={lt.accountName}
                accountLedger={lt.accountLedger}
              />
            )}
          </div>
        ))}
        </div>
      </div>

      {/* ── Settings drawer ─────────────────────────────────────────────── */}
      <BookSettingsDrawer
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        book={book}
        isAdmin={isAdmin}
        onUpdated={next => setBook(next)}
      />
    </div>
  );
}
