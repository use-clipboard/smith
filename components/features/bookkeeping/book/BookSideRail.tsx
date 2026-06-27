'use client';

/**
 * BookSideRail — vertical icon-only navigation down the left edge of an
 * open book, modelled on the mockup.
 *
 * Top section (workspace navigation):
 *   ⊕  New transaction — opens a popout menu of grouped transaction types
 *   🏠 Home
 *   ✏️ Input sheet
 *   ⚖ Trial Balance
 *   ⋮  (dynamic ledger drill-down tabs, closeable)
 *
 * Bottom section:
 *   ⚙ Book settings
 *
 * Replaces both the old top action toolbar AND the old top tab strip.
 * Tooltips on every icon supply context.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Plus, Home as HomeIcon, Search as SearchIcon, Pencil, Scale, X, Settings as SettingsIcon,
  Wallet, ReceiptText, ShoppingCart, BookOpenCheck,
  TrendingUp, Layers, BadgePoundSterling, Users, Building2, FileSpreadsheet,
  Upload, Boxes, BarChart3, Clock, Sparkles, Bot,
  ClipboardCheck, Gauge, ArrowUpRight, HandCoins,
  type LucideIcon,
} from 'lucide-react';
import Tooltip from '@/components/ui/Tooltip';
import type { TransactionType } from '@/types/bookkeeping';

// ── Action menu groups (grouped transaction types) ──────────────────────────
const GROUPS: { name: string; icon: LucideIcon; tone: string; actions: { type: TransactionType; label: string; description: string }[] }[] = [
  {
    name: 'Bank',
    icon: Wallet,
    tone: 'text-emerald-600 bg-emerald-50',
    actions: [
      { type: 'PAY', label: 'PAY', description: 'Bank payment'  },
      { type: 'CHQ', label: 'CHQ', description: 'Cheque payment' },
      { type: 'REC', label: 'REC', description: 'Bank receipt'   },
      { type: 'TRF', label: 'TRF', description: 'Transfer'       },
    ],
  },
  {
    name: 'Sales',
    icon: ReceiptText,
    tone: 'text-blue-600 bg-blue-50',
    actions: [
      { type: 'SIN', label: 'SIN', description: 'Sales invoice'      },
      { type: 'SCR', label: 'SCR', description: 'Sales credit note'  },
    ],
  },
  {
    name: 'Purchases',
    icon: ShoppingCart,
    tone: 'text-amber-600 bg-amber-50',
    actions: [
      { type: 'PIN', label: 'PIN', description: 'Purchase invoice'     },
      { type: 'PCR', label: 'PCR', description: 'Purchase credit note' },
    ],
  },
  {
    name: 'Journals',
    icon: BookOpenCheck,
    tone: 'text-violet-600 bg-violet-50',
    actions: [
      { type: 'JRN', label: 'JRN', description: 'Journal entry' },
      { type: 'RJN', label: 'RJN', description: 'Reversing journal — auto-reverses on a chosen date' },
      { type: 'YET', label: 'YET', description: 'Year-end transaction — closing journal posted on the FY end date' },
      { type: 'DVT', label: 'DVT', description: 'Deferred VAT transfer — moves import VAT between control accounts' },
    ],
  },
  {
    name: 'Adjustments',
    icon: BookOpenCheck,
    tone: 'text-rose-600 bg-rose-50',
    actions: [
      { type: 'WOF', label: 'WOF', description: 'Write off — clear residual supplier/debtor balance' },
      { type: 'WBK', label: 'WBK', description: 'Write back — reinstate a previously written-off balance' },
    ],
  },
];

// Reports grouped behind a single rail flyout — the rail was getting too long
// listing each one individually. Aged debtors/creditors live here too.
// `launch: true` items don't open an in-book tab — they fire onLaunchTool to
// open a separate tool (Accounts Review / Performance) in a new workspace tab,
// pre-populated with this book's statements.
const REPORTS: { id: string; label: string; icon: LucideIcon; launch?: boolean; charityOnly?: boolean }[] = [
  { id: 'tb',             label: 'Trial Balance',             icon: Scale },
  { id: 'pnl',            label: 'Profit & Loss',             icon: TrendingUp },
  { id: 'bs',             label: 'Balance Sheet',             icon: Layers },
  { id: 'sofa',           label: 'SOFA (by fund)',            icon: HandCoins, charityOnly: true },
  { id: 'cf',             label: 'Cash Flow',                 icon: BadgePoundSterling },
  { id: 'aged-debtors',   label: 'Aged Debtors (Customers)',  icon: Clock },
  { id: 'aged-creditors', label: 'Aged Creditors (Suppliers)', icon: Clock },
  { id: 'ai-review',      label: 'AI Book Review',            icon: Sparkles },
  { id: 'accounts-review', label: 'Accounts Review',          icon: ClipboardCheck, launch: true },
  { id: 'performance',     label: 'Performance',              icon: Gauge,          launch: true },
];
// Only the in-book report tabs drive the rail's active-state highlight; the
// launch items never become the active tab.
const REPORT_IDS = new Set(REPORTS.filter(r => !r.launch).map(r => r.id));

export interface LedgerRailTab {
  id: string;
  accountName: string;
  accountLedger: string | null;
}
export interface TypeListRailTab {
  id: string;
  txnType: TransactionType;
}
export interface ManualRecRailTab {
  id: string;
  accountName: string;
}

interface Props {
  /** Currently-active tab id (e.g. 'home', 'input', 'tb', or a dynamic tab id). */
  activeTab: string;
  /** Charity books surface fund-specific reports (the SOFA). */
  showFunds?: boolean;
  onSelectTab: (id: string) => void;
  /** Fired by the launch-type report items (Accounts Review / Performance) to
   *  open that tool in a new tab instead of switching the in-book tab. */
  onLaunchTool?: (tool: 'accounts-review' | 'performance') => void;
  onAction: (type: TransactionType) => void;
  /** Open ledger drill-down tabs — surfaced as their own icons in the rail. */
  ledgerTabs: LedgerRailTab[];
  /** Open transaction-type list tabs (PAY list, REC list, etc.). */
  typeListTabs?: TypeListRailTab[];
  /** Open manual reconciliation entry sheets — one per bank account. */
  manualRecTabs?: ManualRecRailTab[];
  /** Single close handler for any dynamic tab (ledger / type-list / manual-rec). */
  onCloseLedgerTab: (id: string) => void;
  onOpenSettings: () => void;
  /** Opens the book-wide search lightbox (Ctrl+K also triggers it). */
  onOpenSearch?: () => void;
  /** Disable the action button + tabs that should be unavailable. */
  disabled?: boolean;
  /** Match the page width's safe area. */
  className?: string;
}

export default function BookSideRail({
  activeTab, showFunds, onSelectTab, onLaunchTool, onAction, ledgerTabs, typeListTabs = [], manualRecTabs = [],
  onCloseLedgerTab, onOpenSettings, onOpenSearch, disabled, className,
}: Props) {
  const visibleReports = REPORTS.filter(r => !r.charityOnly || showFunds);
  const [actionMenuOpen, setActionMenuOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const popoutRef = useRef<HTMLDivElement>(null);
  const newTxnButtonRef = useRef<HTMLButtonElement>(null);

  // Portal anchor — client-side only so SSR doesn't try.
  const [portalReady, setPortalReady] = useState(false);
  useEffect(() => { setPortalReady(true); }, []);

  // Pop-out position computed from the trigger's rect, then portaled to body
  // so we escape every ancestor's stacking context (the sticky rail otherwise
  // traps z-index, letting in-flow content from neighbouring columns show
  // through the menu).
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const updatePosition = useCallback(() => {
    const trigger = newTxnButtonRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    setPos({ top: rect.top, left: rect.right + 8 });
  }, []);
  useLayoutEffect(() => {
    if (!actionMenuOpen) { setPos(null); return; }
    updatePosition();
    window.addEventListener('scroll', updatePosition, true);
    window.addEventListener('resize', updatePosition);
    return () => {
      window.removeEventListener('scroll', updatePosition, true);
      window.removeEventListener('resize', updatePosition);
    };
  }, [actionMenuOpen, updatePosition]);

  // Close popout on outside click — must also let clicks inside the portaled
  // popout count as "inside".
  useEffect(() => {
    if (!actionMenuOpen) return;
    function onClick(e: MouseEvent) {
      const target = e.target as Node;
      const insideRail   = containerRef.current?.contains(target);
      const insidePopout = popoutRef.current?.contains(target);
      if (!insideRail && !insidePopout) setActionMenuOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [actionMenuOpen]);

  function pickAction(t: TransactionType) {
    onAction(t);
    setActionMenuOpen(false);
  }

  // ── Reports flyout (TB / P&L / BS / CF + aged reports) ──────────────────────
  const reportsButtonRef = useRef<HTMLButtonElement>(null);
  const reportsPopoutRef = useRef<HTMLDivElement>(null);
  const [reportsMenuOpen, setReportsMenuOpen] = useState(false);
  const [reportsPos, setReportsPos] = useState<{ top: number; left: number } | null>(null);
  const updateReportsPosition = useCallback(() => {
    const trigger = reportsButtonRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    setReportsPos({ top: rect.top, left: rect.right + 8 });
  }, []);
  useLayoutEffect(() => {
    if (!reportsMenuOpen) { setReportsPos(null); return; }
    updateReportsPosition();
    window.addEventListener('scroll', updateReportsPosition, true);
    window.addEventListener('resize', updateReportsPosition);
    return () => {
      window.removeEventListener('scroll', updateReportsPosition, true);
      window.removeEventListener('resize', updateReportsPosition);
    };
  }, [reportsMenuOpen, updateReportsPosition]);
  useEffect(() => {
    if (!reportsMenuOpen) return;
    function onClick(e: MouseEvent) {
      const target = e.target as Node;
      const insideRail = containerRef.current?.contains(target);
      const insidePopout = reportsPopoutRef.current?.contains(target);
      if (!insideRail && !insidePopout) setReportsMenuOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [reportsMenuOpen]);
  function pickReport(r: { id: string; launch?: boolean }) {
    setReportsMenuOpen(false);
    if (r.launch) { onLaunchTool?.(r.id as 'accounts-review' | 'performance'); return; }
    onSelectTab(r.id);
  }

  function railButton({
    id, label, tooltip, icon: Icon, active, onClick, disabled: btnDisabled, accent,
  }: {
    id: string;
    label: string;
    tooltip: string;
    icon: LucideIcon;
    active: boolean;
    onClick: () => void;
    disabled?: boolean;
    accent?: 'indigo' | 'emerald';
  }) {
    // Rail uses a deep purple panel — same "you're in the bookkeeping module"
    // signal as the header card. Icons sit in white-ish on purple; active
    // tab gets a brighter (white-on-violet-700) chip so it still stands out.
    // Active tile — back to the original light-tint look (matches the rest
    // of SMITH's white-chrome tools). The accent stripe on the rail's left
    // edge carries the "this is bookkeeping" signal so the active state
    // doesn't need to.
    const accentBg = accent === 'emerald'
      ? 'bg-emerald-50 text-emerald-700'
      : 'bg-indigo-50 text-indigo-700';
    return (
      <Tooltip key={id} label={tooltip} side="right">
        <button
          type="button"
          onClick={onClick}
          disabled={btnDisabled}
          aria-label={label}
          aria-pressed={active}
          className={`w-10 h-10 rounded-lg flex items-center justify-center transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
            active
              ? accentBg
              : 'text-slate-500 hover:bg-slate-100 hover:text-slate-800'
          }`}
        >
          <Icon size={16} />
        </button>
      </Tooltip>
    );
  }

  return (
    <div
      ref={containerRef}
      className={`relative w-14 shrink-0 rounded-xl border border-slate-200 bg-slate-50 shadow flex flex-col items-center py-2 ${className ?? ''}`}
    >
      {/* New transaction (popout trigger) */}
      <Tooltip label={disabled ? 'New transaction — book is locked or archived' : 'New transaction'} side="right">
        <button
          ref={newTxnButtonRef}
          type="button"
          onClick={() => { if (!disabled) { setActionMenuOpen(o => !o); setReportsMenuOpen(false); } }}
          disabled={disabled}
          aria-label="New transaction"
          aria-expanded={actionMenuOpen}
          className={`w-10 h-10 rounded-lg flex items-center justify-center transition-all disabled:opacity-40 disabled:cursor-not-allowed ${
            actionMenuOpen
              ? 'bg-indigo-600 text-white shadow-sm shadow-indigo-600/30'
              : 'bg-indigo-50 text-indigo-700 hover:bg-indigo-100'
          }`}
        >
          <Plus size={16} />
        </button>
      </Tooltip>

      {/* Divider */}
      <div className="w-6 h-px bg-slate-200 my-2" aria-hidden />

      {/* Workspace nav */}
      <div className="flex flex-col items-center gap-1">
        {railButton({
          id: 'home', label: 'Home', tooltip: 'Home',
          icon: HomeIcon, active: activeTab === 'home',
          onClick: () => onSelectTab('home'),
        })}
        {/* Search — opens the book-wide search lightbox. Ctrl+K also fires
            this from anywhere in the book. Doesn't have a tab to "activate"
            since the lightbox sits on top of whatever tab is current. */}
        {railButton({
          id: 'search', label: 'Search', tooltip: 'Search · Ctrl+K',
          icon: SearchIcon, active: false,
          onClick: () => onOpenSearch?.(),
        })}
        {railButton({
          id: 'input', label: 'Input sheet', tooltip: 'Input sheet',
          icon: Pencil, active: activeTab === 'input',
          onClick: () => onSelectTab('input'),
          disabled,
        })}
        {/* Reports — single flyout for TB / P&L / BS / CF + aged reports. */}
        <Tooltip label="Reports" side="right">
          <button
            ref={reportsButtonRef}
            type="button"
            onClick={() => { setReportsMenuOpen(o => !o); setActionMenuOpen(false); }}
            aria-label="Reports"
            aria-expanded={reportsMenuOpen}
            aria-pressed={REPORT_IDS.has(activeTab)}
            className={`w-10 h-10 rounded-lg flex items-center justify-center transition-colors ${
              reportsMenuOpen || REPORT_IDS.has(activeTab)
                ? 'bg-indigo-50 text-indigo-700'
                : 'text-slate-500 hover:bg-slate-100 hover:text-slate-800'
            }`}
          >
            <BarChart3 size={16} />
          </button>
        </Tooltip>
        {railButton({
          id: 'vat', label: 'VAT Return', tooltip: 'VAT Return — quarterly 9-box',
          icon: FileSpreadsheet, active: activeTab === 'vat',
          onClick: () => onSelectTab('vat'),
        })}
        {railButton({
          id: 'bank', label: 'Bank', tooltip: 'Bank ledger + reconciliations',
          icon: Wallet, active: activeTab === 'bank',
          onClick: () => onSelectTab('bank'),
        })}
        {railButton({
          id: 'customers', label: 'Customers', tooltip: 'Customers ledger + matching',
          icon: Users, active: activeTab === 'customers',
          onClick: () => onSelectTab('customers'),
        })}
        {railButton({
          id: 'suppliers', label: 'Suppliers', tooltip: 'Suppliers ledger + matching',
          icon: Building2, active: activeTab === 'suppliers',
          onClick: () => onSelectTab('suppliers'),
        })}
        {railButton({
          id: 'fixed-assets', label: 'Fixed assets', tooltip: 'Fixed assets — depreciation register',
          icon: Boxes, active: activeTab === 'fixed-assets',
          onClick: () => onSelectTab('fixed-assets'),
        })}
        {railButton({
          id: 'ai-adviser', label: 'AI Adviser', tooltip: 'AI Adviser — discuss entries & prepare journals',
          icon: Bot, active: activeTab === 'ai-adviser',
          onClick: () => onSelectTab('ai-adviser'),
        })}
        {/* Bulk Import lives on the home-page Quick Actions card now, not
            the rail — it's a deliberate occasional action rather than a
            day-to-day surface that needs constant access. */}
      </div>

      {/* Dynamic drill-down tabs — ledger accounts AND transaction-type lists */}
      {(ledgerTabs.length > 0 || typeListTabs.length > 0 || manualRecTabs.length > 0) && (
        <>
          <div className="w-6 h-px bg-slate-200 my-2" aria-hidden />
          {/* pt-1.5 pr-1.5: the ✕ close-buttons on each tab sit at -top-1
              / -right-1 (negative offsets), which would otherwise be clipped
              by overflow-y-auto. The padding gives them room to render fully. */}
          <div className="flex flex-col items-center gap-1 max-h-[40vh] overflow-y-auto w-full px-1 pt-1.5 pr-1.5">
            {/* Manual rec entry sheets — one per open bank account. Render
                first so the "live work in progress" sits at the top. */}
            {manualRecTabs.map(mr => {
              const active = activeTab === mr.id;
              return (
                <div key={mr.id} className="relative group">
                  <Tooltip label={`Manual rec — ${mr.accountName} — click ✕ to close`} side="right">
                    <button
                      type="button"
                      onClick={() => onSelectTab(mr.id)}
                      aria-label={`Open manual rec for ${mr.accountName}`}
                      aria-pressed={active}
                      className={`w-10 h-10 rounded-lg flex items-center justify-center transition-colors ${
                        active
                          ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                          : 'text-emerald-700 hover:bg-emerald-50 border border-emerald-200 bg-emerald-50/40'
                      }`}
                    >
                      <Pencil size={14} />
                    </button>
                  </Tooltip>
                  <button
                    type="button"
                    onClick={() => onCloseLedgerTab(mr.id)}
                    aria-label={`Close manual rec for ${mr.accountName}`}
                    className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-white border border-slate-300 text-slate-400 hover:text-red-600 hover:border-red-300 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity"
                  >
                    <X size={9} />
                  </button>
                </div>
              );
            })}
            {/* Type-list tabs (PAY / SIN / JRN etc.) render next — they're the
                higher-level navigation, account drill-downs sit below. */}
            {typeListTabs.map(tt => {
              const active = activeTab === tt.id;
              return (
                <div key={tt.id} className="relative group">
                  <Tooltip label={`${tt.txnType} list — click ✕ to close`} side="right">
                    <button
                      type="button"
                      onClick={() => onSelectTab(tt.id)}
                      aria-label={`Open ${tt.txnType} list`}
                      aria-pressed={active}
                      className={`w-10 h-10 rounded-lg flex items-center justify-center text-[10px] font-mono font-semibold transition-colors ${
                        active
                          ? 'bg-indigo-50 text-indigo-700 border border-indigo-200'
                          : 'text-slate-600 hover:bg-slate-100 border border-slate-200'
                      }`}
                    >
                      {tt.txnType}
                    </button>
                  </Tooltip>
                  <button
                    type="button"
                    onClick={() => onCloseLedgerTab(tt.id)}
                    aria-label={`Close ${tt.txnType} list`}
                    className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-white border border-slate-300 text-slate-400 hover:text-red-600 hover:border-red-300 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity"
                  >
                    <X size={9} />
                  </button>
                </div>
              );
            })}
            {ledgerTabs.map(lt => {
              const active = activeTab === lt.id;
              const initials = lt.accountName.slice(0, 2).toUpperCase();
              return (
                <div key={lt.id} className="relative group">
                  <Tooltip
                    label={`${lt.accountLedger ? lt.accountLedger + ': ' : ''}${lt.accountName} — click ✕ to close`}
                    side="right"
                  >
                    <button
                      type="button"
                      onClick={() => onSelectTab(lt.id)}
                      aria-label={`Open ${lt.accountName}`}
                      aria-pressed={active}
                      className={`w-10 h-10 rounded-lg flex items-center justify-center text-[11px] font-semibold transition-colors ${
                        active
                          ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                          : 'text-slate-600 hover:bg-slate-100 border border-slate-200'
                      }`}
                    >
                      {initials}
                    </button>
                  </Tooltip>
                  <button
                    type="button"
                    onClick={() => onCloseLedgerTab(lt.id)}
                    aria-label={`Close ${lt.accountName}`}
                    className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-white border border-slate-300 text-slate-400 hover:text-red-600 hover:border-red-300 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity"
                  >
                    <X size={9} />
                  </button>
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* Spacer + settings at bottom */}
      <div className="flex-1" aria-hidden />
      <div className="w-6 h-px bg-slate-200 my-2" aria-hidden />
      <Tooltip label="Book settings" side="right">
        <button
          type="button"
          onClick={onOpenSettings}
          aria-label="Book settings"
          className="w-10 h-10 rounded-lg flex items-center justify-center text-slate-500 hover:bg-slate-100 hover:text-slate-800 transition-colors"
        >
          <SettingsIcon size={15} />
        </button>
      </Tooltip>

      {/* ── Popout: New transaction menu ───────────────────────────────────── */}
      {/* Portaled to body so it escapes the sticky-rail stacking context. The
          AccountPicker portal is also at z-[1200]; we sit at z-[1400] so the
          popout always wins. */}
      {actionMenuOpen && portalReady && pos && createPortal(
        <div
          ref={popoutRef}
          role="menu"
          aria-label="Pick a transaction type"
          style={{ position: 'fixed', top: pos.top, left: pos.left, width: 288 }}
          className="rounded-xl border border-slate-200 bg-white shadow-xl z-[1400] overflow-hidden"
        >
          <div className="px-3 py-2 border-b border-slate-100 flex items-center gap-2">
            <Plus size={13} className="text-indigo-600" />
            <span className="text-xs font-semibold text-slate-900">New transaction</span>
            <span className="text-[10px] text-slate-400">— pick a type</span>
          </div>
          <div className="p-2 space-y-2">
            {GROUPS.map(g => {
              const Icon = g.icon;
              return (
                <div key={g.name}>
                  <div className="flex items-center gap-1.5 px-1 mb-1">
                    <span className={`w-5 h-5 rounded ${g.tone} flex items-center justify-center`}>
                      <Icon size={11} />
                    </span>
                    <span className="text-[10px] uppercase tracking-wide font-semibold text-slate-500">
                      {g.name}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-1">
                    {g.actions.map(a => (
                      <Tooltip key={a.type} label={a.description}>
                        <button
                          type="button"
                          onClick={() => pickAction(a.type)}
                          className="px-2 py-1.5 rounded-md text-xs font-semibold tracking-wide border border-slate-200 bg-white text-slate-700 hover:bg-indigo-50 hover:text-indigo-700 hover:border-indigo-200 transition-colors text-left"
                        >
                          {a.label}
                        </button>
                      </Tooltip>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>,
        document.body,
      )}

      {/* ── Popout: Reports menu ─────────────────────────────────────────────── */}
      {reportsMenuOpen && portalReady && reportsPos && createPortal(
        <div
          ref={reportsPopoutRef}
          role="menu"
          aria-label="Reports"
          style={{ position: 'fixed', top: reportsPos.top, left: reportsPos.left, width: 236 }}
          className="rounded-xl border border-slate-200 bg-white shadow-xl z-[1400] overflow-hidden"
        >
          <div className="px-3 py-2 border-b border-slate-100 flex items-center gap-2">
            <BarChart3 size={13} className="text-indigo-600" />
            <span className="text-xs font-semibold text-slate-900">Reports</span>
          </div>
          <div className="p-1.5">
            {visibleReports.map((r, i) => {
              const Icon = r.icon;
              const active = activeTab === r.id;
              // Visually separate the "launch another tool" items from the
              // in-book reports with a labelled divider.
              const firstLaunch = r.launch && !visibleReports[i - 1]?.launch;
              return (
                <div key={r.id}>
                  {firstLaunch && (
                    <div className="flex items-center gap-2 px-2.5 pt-2 pb-1">
                      <div className="h-px flex-1 bg-slate-100" />
                      <span className="text-[9px] uppercase tracking-wide font-semibold text-slate-400">Analyse in</span>
                      <div className="h-px flex-1 bg-slate-100" />
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => pickReport(r)}
                    className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-md text-sm text-left transition-colors ${
                      active ? 'bg-indigo-50 text-indigo-700 font-medium' : 'text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    <Icon size={14} className={active ? 'text-indigo-600' : 'text-slate-400'} />
                    {r.label}
                    {r.launch && <ArrowUpRight size={13} className="ml-auto text-slate-400" />}
                  </button>
                </div>
              );
            })}
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
