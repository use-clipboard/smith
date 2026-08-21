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
  Archive as ArchiveIcon, PanelRightClose, PanelRightOpen,
} from 'lucide-react';
import ToolLayout from '@/components/ui/ToolLayout';
import BookHomeTab from './book/BookHomeTab';
import BookSettingsDrawer from './book/BookSettingsDrawer';
import BookRecurringModal from './book/BookRecurringModal';
import VatThresholdBanner from './book/VatThresholdBanner';
import YearEndsDialog from './book/YearEndsDialog';
import BookSideRail from './book/BookSideRail';
import LaunchAnalysisDialog, { type AnalysisTool } from './book/LaunchAnalysisDialog';
import MultiTypeInputSheet from './input/MultiTypeInputSheet';
import EntryToastHost, { type EntryToast } from './input/EntryToastHost';
import { isInputSheetType } from '@/lib/bookkeeping/transactionTypeConfig';
import TrialBalanceTab from './reports/TrialBalanceTab';
import ProfitLossTab from './reports/ProfitLossTab';
import BalanceSheetTab from './reports/BalanceSheetTab';
import ManagementAccountsTab from './reports/ManagementAccountsTab';
import SofaTab from './reports/SofaTab';
import CashFlowTab from './reports/CashFlowTab';
import VatReturnTab from './reports/VatReturnTab';
import AccountLedgerTab from './reports/AccountLedgerTab';
import AgedReportTab from './reports/AgedReportTab';
import BookReviewTab from './reports/BookReviewTab';
import BookAssistantTab from './reports/BookAssistantTab';
import AccountsLedgerView from './ledger/AccountsLedgerView';
import FixedAssetsTab from './book/FixedAssetsTab';
import TransactionTypeListView from './transactions/TransactionTypeListView';
import ManualBankRecSheet from './ledger/ManualBankRecSheet';
import BookImportTab from './imports/BookImportTab';
import BookSearchLightbox from './book/BookSearchLightbox';
import { BookNavigationProvider, type ActivePeriod } from './book/BookNavigationContext';
import BookYearPeriodBar from './book/BookYearPeriodBar';
import { BOOK_TEMPLATE_LABEL, VAT_SCHEME_LABEL, type Book, type TransactionType } from '@/types/bookkeeping';

interface Props {
  bookId: string;
  userRole: 'admin' | 'staff';
  /** Current user — threaded through to the home-tab whiteboard so notes
   *  can be attributed and the eraser/own-note UI knows who's looking. */
  currentUserId: string;
  currentUserName: string | null;
  /** Optional close handler. When the bookkeeping module is hosted by the
   *  always-mounted BookkeepingTool wrapper, this fires instead of a route
   *  push so the wrapper can swap views without unmounting. Falls back to
   *  `router.push('/bookkeeping')` when omitted (direct URL access). */
  onCloseBook?: () => void;
}

// Fixed tabs are always present. Dynamic tabs (per-account ledger drill-downs)
// are added on demand by the TB and closeable.
type FixedTab = 'home' | 'input' | 'tb' | 'pnl' | 'bs' | 'cf' | 'mgmt-accounts' | 'sofa' | 'vat' | 'bank' | 'customers' | 'suppliers' | 'fixed-assets' | 'import' | 'aged-debtors' | 'aged-creditors' | 'ai-review';
interface DynamicLedgerTab {
  id: string;                  // unique tab id: `ledger:<accountId>`
  kind: 'ledger';
  accountId: string;
  accountName: string;
  accountLedger: string | null;
  accountCode?: string | null;
}
interface DynamicTypeListTab {
  id: string;                  // unique tab id: `type:<TYPE>`
  kind: 'type_list';
  txnType: TransactionType;
  /** Optional initially-selected transaction id. Used when the user clicks
   *  a ref elsewhere — we want them to land on that transaction. */
  initialTxnId?: string;
}
interface DynamicManualRecTab {
  id: string;                  // unique tab id: `manual-rec:<accountId>`
  kind: 'manual_rec';
  accountId: string;
  accountName: string;
}
type DynamicTab = DynamicLedgerTab | DynamicTypeListTab | DynamicManualRecTab;
type AnyTab = FixedTab | string; // string for dynamic tabs (their id)

function formatDateUk(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

export default function BookView({ bookId, userRole, currentUserId, currentUserName, onCloseBook }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const isAdmin = userRole === 'admin';

  const [book, setBook]       = useState<Book | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [yearEndsOpen, setYearEndsOpen] = useState(false);
  const [recurringOpen, setRecurringOpen] = useState(false);
  /** Which external analysis tool the user is launching from the Reports menu
   *  (opens the period-picker dialog); null = closed. */
  const [launchTool, setLaunchTool] = useState<AnalysisTool | null>(null);
  /** Book-wide search lightbox — opens from the Search rail button,
   *  Ctrl+K shortcut, or the home tab's "View all" recent-transactions link. */
  const [searchOpen, setSearchOpen] = useState(false);

  // AI assistant — a toggleable right-hand panel (matches Accounts Studio).
  // Preference is remembered so it stays open/closed across books.
  const [assistantOpen, setAssistantOpen] = useState(false);
  useEffect(() => {
    try { setAssistantOpen(localStorage.getItem('smith.bookkeeping.assistantOpen') === '1'); } catch { /* ignore */ }
  }, []);
  const toggleAssistant = () => setAssistantOpen(v => {
    const next = !v;
    try { localStorage.setItem('smith.bookkeeping.assistantOpen', next ? '1' : '0'); } catch { /* ignore */ }
    return next;
  });

  // Focus mode is a global capability — provided by FocusModeProvider in
  // AppShell (toggle lives in the TopBar). Nothing to wire up locally.

  // ── Ctrl+K / ⌘K global shortcut to open the search lightbox ─────────────
  // Bound at the BookView level so it works on every tab. We deliberately
  // intercept even when an input is focused — the user might be mid-edit and
  // want to look something up; the lightbox will steal focus into its own
  // search box on open. Pressing it again (or Escape) closes.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const isK = (e.key === 'k' || e.key === 'K');
      if (isK && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        setSearchOpen(o => !o);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Tab state — initialised from ?tab=… so deep-links work.
  const initialTabParam = searchParams?.get('tab');
  const initialTab: FixedTab =
    initialTabParam === 'input' ? 'input' :
    initialTabParam === 'tb'    ? 'tb'    :
    initialTabParam === 'pnl'   ? 'pnl'   :
    initialTabParam === 'bs'    ? 'bs'    :
    initialTabParam === 'cf'    ? 'cf'    :
    initialTabParam === 'vat'   ? 'vat'   :
    initialTabParam === 'bank'      ? 'bank'      :
    initialTabParam === 'customers' ? 'customers' :
    initialTabParam === 'suppliers' ? 'suppliers' :
    initialTabParam === 'fixed-assets' ? 'fixed-assets' : 'home';
  const [tab, setTab] = useState<AnyTab>(initialTab);

  // Dynamic tabs (per-account ledger drill-downs AND per-type lists) — both
  // open from row clicks on transaction lists. Held in a single array so the
  // rail renders them in order of appearance.
  const [dynamicTabs, setDynamicTabs] = useState<DynamicTab[]>([]);

  function openLedgerTab(account: { id: string; name: string; ledger: string | null; code?: string | null }) {
    if (!account.id) return; // ignore ledger-row clicks (not yet wired)
    const tabId = `ledger:${account.id}`;
    setDynamicTabs(prev => {
      if (prev.some(t => t.id === tabId)) return prev;
      return [...prev, {
        id: tabId,
        kind: 'ledger',
        accountId: account.id,
        accountName: account.name,
        accountLedger: account.ledger,
        accountCode: account.code ?? null,
      }];
    });
    setTab(tabId);
  }
  /** Opens the type-list tab for a transaction type, optionally pre-selecting
   *  a specific transaction. Called by the click-handlers on ref numbers
   *  across the various transaction lists. */
  function openTypeListTab(txnType: TransactionType, initialTxnId?: string) {
    const tabId = `type:${txnType}`;
    setDynamicTabs(prev => {
      const existing = prev.find(t => t.id === tabId);
      if (existing && existing.kind === 'type_list') {
        // Already open — just update its initial selection so a re-click
        // from another list focuses the right transaction.
        return prev.map(t => t.id === tabId && t.kind === 'type_list'
          ? { ...t, initialTxnId } : t);
      }
      return [...prev, { id: tabId, kind: 'type_list', txnType, initialTxnId }];
    });
    setTab(tabId);
  }
  function closeDynamicTab(tabId: string) {
    setDynamicTabs(prev => prev.filter(t => t.id !== tabId));
    setTab(prev => (prev === tabId ? 'home' : prev));
  }
  /** Open the manual reconciliation entry sheet as its own rail tab —
   *  mirrors how UniversalInputSheet lives in the Input tab. Avoids the
   *  modal focus-trap headaches and gives the sheet the whole workspace. */
  function openManualRecTab(accountId: string, accountName: string) {
    const tabId = `manual-rec:${accountId}`;
    setDynamicTabs(prev => {
      if (prev.some(t => t.id === tabId)) return prev;
      return [...prev, { id: tabId, kind: 'manual_rec', accountId, accountName }];
    });
    setTab(tabId);
  }
  /** Open a whole ledger's master view. Customers/Suppliers are fixed tabs
   *  in the rail; any other ledger opens AccountsLedgerView via a dynamic
   *  tab without pre-selecting an account (it auto-picks the first with
   *  movement). */
  function openLedgerView(ledger: string) {
    if (ledger === 'Customers') { setTab('customers'); return; }
    if (ledger === 'Suppliers') { setTab('suppliers'); return; }
    if (ledger === 'Bank')      { setTab('bank');      return; }
    const tabId = `ledger-all:${ledger}`;
    setDynamicTabs(prev => {
      if (prev.some(t => t.id === tabId)) return prev;
      return [...prev, {
        id: tabId,
        kind: 'ledger',
        accountId: '',          // empty → AccountsLedgerView auto-picks first with movement
        accountName: ledger,
        accountLedger: ledger,
      }];
    });
    setTab(tabId);
  }

  // Current input-sheet type. Controlled here so the toolbar can drive it
  // (clicking PAY/CHQ/REC/… switches the sheet without leaving the tab).
  const [inputType, setInputType] = useState<TransactionType>('PAY');

  // Active reporting period from the BookYearPeriodBar — broadcast to every
  // report (TB/P&L/BS/CF) via BookNavigation. Defaults to the empty / not-
  // ready state until the bar mounts and emits one.
  const [activePeriod, setActivePeriod] = useState<ActivePeriod>({
    ready: false, fromIso: null, toIso: null, fyStartIso: null, fyEndIso: null, label: 'No year set',
  });

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

  // ── Quick-entry toasts ───────────────────────────────────────────────────
  // Picking a type from the side-rail "+" menu opens a floating entry panel
  // (bottom-right, minimisable, stackable) hosting the same input grid — rather
  // than navigating to the full Input tab. The user keeps their current ledger
  // / report in view while entering. Other entry points (Home tab, "Add
  // Transaction") still use the Input tab via setInputType/setTab directly.
  const [entryToasts, setEntryToasts] = useState<EntryToast[]>([]);

  function handleAction(type: TransactionType) {
    setEntryToasts(prev => [
      ...prev,
      { id: Math.random().toString(36).slice(2), type, minimised: false },
    ]);
  }

  const setEntryToastType = useCallback((id: string, type: TransactionType) => {
    setEntryToasts(prev => prev.map(t => (t.id === id ? { ...t, type } : t)));
  }, []);
  const setEntryToastMinimised = useCallback((id: string, minimised: boolean) => {
    setEntryToasts(prev => prev.map(t => (t.id === id ? { ...t, minimised } : t)));
  }, []);
  const closeEntryToast = useCallback((id: string) => {
    setEntryToasts(prev => prev.filter(t => t.id !== id));
  }, []);
  // Bring a panel to the front by moving it to the end of the array (it renders
  // last → highest z-index in EntryToastHost).
  const focusEntryToast = useCallback((id: string) => {
    setEntryToasts(prev => {
      const found = prev.find(t => t.id === id);
      if (!found || prev[prev.length - 1]?.id === id) return prev;
      return [...prev.filter(t => t.id !== id), found];
    });
  }, []);

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
    <BookNavigationProvider value={{
      bookId,
      openAccount: openLedgerTab,
      openTypeList: openTypeListTab,
      openLedger: openLedgerView,
      openManualRec: openManualRecTab,
      activePeriod,
      dataVersion: refreshKey,
      bumpDataVersion: bumpRefresh,
    }}>
    <div className="p-4 max-w-[1600px] mx-auto flex gap-3 items-start">
      {/* ── Side rail ───────────────────────────────────────────────────── */}
      <BookSideRail
        activeTab={tab}
        showFunds={book.template_type === 'charity'}
        onSelectTab={(id) => setTab(id as typeof tab)}
        onLaunchTool={setLaunchTool}
        onAction={handleAction}
        ledgerTabs={dynamicTabs
          .filter((t): t is DynamicLedgerTab => t.kind === 'ledger')
          .map(lt => ({
            id: lt.id,
            accountName: lt.accountName,
            accountLedger: lt.accountLedger,
          }))}
        typeListTabs={dynamicTabs
          .filter((t): t is DynamicTypeListTab => t.kind === 'type_list')
          .map(tt => ({ id: tt.id, txnType: tt.txnType }))}
        manualRecTabs={dynamicTabs
          .filter((t): t is DynamicManualRecTab => t.kind === 'manual_rec')
          .map(mr => ({ id: mr.id, accountName: mr.accountName }))}
        onCloseLedgerTab={closeDynamicTab}
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenRecurring={() => setRecurringOpen(true)}
        onOpenSearch={() => setSearchOpen(true)}
        disabled={lockedForMe || book.archived}
        className="sticky top-4 self-start"
      />

      {/* ── Main column ──────────────────────────────────────────────────── */}
      <div className="flex-1 min-w-0">
        {/* Header card — deep purple "you're in the bookkeeping module"
            band so the workspace chrome doesn't blend into the rest of
            the app. Text colours inverted to white/violet-200. */}
        {/* Option C — soft off-white card with a meaningfully stronger
            shadow. No colour at all — the chrome reads as a "raised
            surface" sitting above the page, like a header bar in an
            elevated panel. Closest to QuickBooks / Xero's approach. */}
        <div className="rounded-xl border border-slate-200 bg-slate-50 shadow mb-3">
          <div className="p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center shrink-0">
              <BookCopy size={18} />
            </div>
            <div className="flex-1 min-w-0">
              <h1 className="text-base font-semibold text-slate-900 truncate leading-tight">{book.name}</h1>
              <div className="text-[11px] text-slate-600 flex items-center gap-1.5 flex-wrap mt-0.5">
                <span>Client:</span>
                <span className="font-medium text-slate-800">{clientLabel}</span>
                <span className="text-slate-300">·</span>
                <span>Template:</span>
                <span className="font-medium text-slate-800">{BOOK_TEMPLATE_LABEL[book.template_type]}</span>
                <span className="text-slate-300">·</span>
                <span className="font-medium text-slate-800">{book.base_currency}</span>
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
                {/* Year / period / lock controls sit inline with the rest of
                    the metadata. When the book has no year-end set the bar
                    collapses to a single amber call-to-action. */}
                <span className="text-slate-300">·</span>
                <BookYearPeriodBar
                  bookId={bookId}
                  periodLockDate={book.period_lock_date}
                  yearEndMd={book.year_end_md}
                  currentFyId={book.current_fy_id ?? null}
                  onOpenSettings={() => setSettingsOpen(true)}
                  onOpenYearEnds={() => setYearEndsOpen(true)}
                  onPeriodChange={setActivePeriod}
                  refreshKey={refreshKey}
                />
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
              onClick={toggleAssistant}
              className={`inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border transition-colors ${
                assistantOpen
                  ? 'border-indigo-300 bg-indigo-50 text-indigo-700'
                  : 'border-slate-200 bg-white hover:border-indigo-200 hover:bg-indigo-50 text-slate-700 hover:text-indigo-700'
              }`}
            >
              {assistantOpen ? <PanelRightClose size={13} /> : <PanelRightOpen size={13} />} Assistant
            </button>
            <button
              onClick={() => { if (onCloseBook) onCloseBook(); else router.push('/bookkeeping'); }}
              className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-slate-200 hover:border-indigo-200 bg-white hover:bg-indigo-50 text-slate-700 hover:text-indigo-700 transition-colors"
            >
              <ChevronLeft size={13} /> Books
            </button>
          </div>
        </div>

        {/* VAT threshold warnings — yellow approaching, red once passed. */}
        <div className="mb-3">
          <VatThresholdBanner bookId={bookId} key={`vat-thresh-${refreshKey}`} />
        </div>

        {/* ── Tab content + AI assistant panel ─────────────────────────────── */}
        <div className="flex gap-3 items-start">
        <div className="min-w-0 flex-1">
        <div hidden={tab !== 'home'}>
          <BookHomeTab
            book={book}
            onDelete={handleDelete}
            onAddTransaction={() => { setInputType('PAY'); setTab('input'); }}
            onImport={() => setTab('import')}
            onOpenSearch={() => setSearchOpen(true)}
            refreshKey={refreshKey}
            onChanged={bumpRefresh}
            onOpenAccount={openLedgerTab}
            onOpenTypeList={openTypeListTab}
            currentUserId={currentUserId}
            currentUserName={currentUserName}
          />
        </div>
        <div hidden={tab !== 'input'}>
          {/* The Input tab is the VT-style universal sheet: many transactions of
              different types & dates in one grid. Journals (JRN/RJN/YET/DVT) are
              entered via the quick-entry toast instead. */}
          <MultiTypeInputSheet
            bookId={bookId}
            vatRegistered={book.vat_registered}
            vatScheme={book.vat_scheme}
            vatLockDate={book.vat_lock_date}
            defaultDateIso={activePeriod.toIso}
            initialType={isInputSheetType(inputType) ? inputType : 'PAY'}
            onPosted={bumpRefresh}
          />
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
        <div hidden={tab !== 'mgmt-accounts'}>
          <ManagementAccountsTab
            bookId={bookId}
            entityName={book.client?.name ?? book.name}
            onOpenAccount={openLedgerTab}
          />
        </div>
        {book.template_type === 'charity' && (
          <div hidden={tab !== 'sofa'}>
            <SofaTab bookId={bookId} fromIso={activePeriod.fromIso} toIso={activePeriod.toIso} periodLabel={activePeriod.label} />
          </div>
        )}
        <div hidden={tab !== 'vat'}>
          <VatReturnTab
            bookId={bookId}
            isAdmin={isAdmin}
            activePeriodLabel={activePeriod.label}
            activePeriodFromIso={activePeriod.fromIso}
            activePeriodToIso={activePeriod.toIso}
          />
        </div>
        <div hidden={tab !== 'aged-debtors'}>
          <AgedReportTab bookId={bookId} ledger="Customers" defaultAsAtIso={activePeriod.toIso} />
        </div>
        <div hidden={tab !== 'aged-creditors'}>
          <AgedReportTab bookId={bookId} ledger="Suppliers" defaultAsAtIso={activePeriod.toIso} />
        </div>
        <div hidden={tab !== 'ai-review'}>
          <BookReviewTab bookId={bookId} bookName={book.name} fromIso={activePeriod.fromIso} toIso={activePeriod.toIso} />
        </div>
        <div hidden={tab !== 'bank'}>
          <AccountsLedgerView bookId={bookId} ledger="Bank" isAdmin={isAdmin} />
        </div>
        <div hidden={tab !== 'customers'}>
          <AccountsLedgerView bookId={bookId} ledger="Customers" isAdmin={isAdmin} />
        </div>
        <div hidden={tab !== 'suppliers'}>
          <AccountsLedgerView bookId={bookId} ledger="Suppliers" isAdmin={isAdmin} />
        </div>
        <div hidden={tab !== 'fixed-assets'}>
          <FixedAssetsTab bookId={bookId} isAdmin={isAdmin} active={tab === 'fixed-assets'} />
        </div>
        <div hidden={tab !== 'import'}>
          {/* onChanged fires after a successful Post OR Rollback — same
              bumpRefresh used by the input sheets, so the Home tab's recent-
              transactions feed + Key Information balances refresh straight
              away without a page reload. */}
          <BookImportTab bookId={bookId} isAdmin={isAdmin} bookName={book.name} firstPeriodStart={book.first_period_start} clientId={book.client_id} onChanged={bumpRefresh} />
        </div>
        {dynamicTabs.map(dt => {
          if (dt.kind === 'ledger') {
            return (
              <div key={dt.id} hidden={tab !== dt.id}>
                {dt.accountLedger ? (
                  <AccountsLedgerView
                    bookId={bookId}
                    ledger={dt.accountLedger}
                    initialAccountId={dt.accountId}
                    isAdmin={isAdmin}
                  />
                ) : (
                  <AccountLedgerTab
                    bookId={bookId}
                    accountId={dt.accountId}
                    accountName={dt.accountName}
                    accountLedger={dt.accountLedger}
                    accountCode={dt.accountCode}
                  />
                )}
              </div>
            );
          }
          if (dt.kind === 'type_list') {
            return (
              <div key={dt.id} hidden={tab !== dt.id}>
                <TransactionTypeListView
                  bookId={bookId}
                  type={dt.txnType}
                  initialTxnId={dt.initialTxnId}
                  onNewTransaction={() => handleAction(dt.txnType)}
                />
              </div>
            );
          }
          // dt.kind === 'manual_rec' — VT-style bank cash book entry sheet.
          return (
            <div key={dt.id} hidden={tab !== dt.id}>
              <ManualBankRecSheet
                bookId={bookId}
                accountId={dt.accountId}
                accountName={dt.accountName}
                vatRegistered={book.vat_registered}
                onClose={() => closeDynamicTab(dt.id)}
                onPosted={() => {
                  closeDynamicTab(dt.id);
                  setTab('bank');
                  bumpRefresh();
                }}
              />
            </div>
          );
        })}
        </div>

        {/* AI assistant — toggleable right-hand panel. Kept mounted and hidden
            via display so the conversation survives closing/reopening. */}
        <div className={assistantOpen ? 'hidden xl:block w-[420px] shrink-0 sticky top-4 self-start' : 'hidden'}>
          <BookAssistantTab bookId={bookId} bookName={book.name} onPosted={bumpRefresh} active={assistantOpen} fromIso={activePeriod.fromIso} toIso={activePeriod.toIso} />
        </div>
        </div>
      </div>

      {/* ── Settings drawer ─────────────────────────────────────────────── */}
      <BookSettingsDrawer
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        book={book}
        isAdmin={isAdmin}
        // Bump the refresh key too so VAT-status-dependent chrome (the threshold
        // banner, the header VAT badge) re-reads after a change is recorded.
        onUpdated={next => { setBook(next); bumpRefresh(); }}
      />

      {/* ── Recurring (memorised) transactions ─────────────────────────────── */}
      <BookRecurringModal
        bookId={bookId}
        open={recurringOpen}
        onClose={() => setRecurringOpen(false)}
        onPosted={bumpRefresh}
      />

      {/* ── Financial-year management (close / reopen) ──────────────────────── */}
      {yearEndsOpen && (
        <YearEndsDialog
          bookId={bookId}
          isAdmin={isAdmin}
          // Bump on close too: the dialog's own generate=true load may have
          // pruned empty future placeholders, so re-sync the year dropdown
          // even when the user didn't explicitly close/reopen/change a year.
          onClose={() => { setYearEndsOpen(false); bumpRefresh(); }}
          onChanged={() => { load(); bumpRefresh(); }}
        />
      )}

      {/* ── Book search lightbox — Ctrl+K / rail Search icon / Home View all */}
      {searchOpen && (
        <BookSearchLightbox
          bookId={bookId}
          bookName={book.name}
          vatRegistered={book.vat_registered}
          vatLockDate={book.vat_lock_date ?? null}
          onOpenAccount={openLedgerTab}
          onOpenTypeList={openTypeListTab}
          onClose={() => setSearchOpen(false)}
        />
      )}

      {/* ── Launch Accounts Review / Performance from the book's figures ────── */}
      {launchTool && (
        <LaunchAnalysisDialog
          bookId={bookId}
          tool={launchTool}
          activePeriod={activePeriod}
          onClose={() => setLaunchTool(null)}
        />
      )}

      {/* ── Quick-entry toasts (side-rail "+" menu) ─────────────────────────── */}
      <EntryToastHost
        toasts={entryToasts}
        bookId={bookId}
        vatRegistered={book.vat_registered}
        vatScheme={book.vat_scheme}
        vatLockDate={book.vat_lock_date}
        defaultDateIso={activePeriod.toIso}
        onTypeChange={setEntryToastType}
        onMinimise={setEntryToastMinimised}
        onClose={closeEntryToast}
        onFocus={focusEntryToast}
        onPosted={bumpRefresh}
      />
    </div>
    </BookNavigationProvider>
  );
}
