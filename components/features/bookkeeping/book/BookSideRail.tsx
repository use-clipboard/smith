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
  Plus, Home as HomeIcon, Pencil, Scale, X, Settings as SettingsIcon,
  Wallet, ReceiptText, ShoppingCart, BookOpenCheck,
  TrendingUp, Layers, BadgePoundSterling, Users, Building2, FileSpreadsheet,
} from 'lucide-react';
import Tooltip from '@/components/ui/Tooltip';
import type { TransactionType } from '@/types/bookkeeping';

// ── Action menu groups (grouped transaction types) ──────────────────────────
const GROUPS: { name: string; icon: React.ComponentType<{ size?: number; className?: string }>; tone: string; actions: { type: TransactionType; label: string; description: string }[] }[] = [
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
    ],
  },
];

export interface LedgerRailTab {
  id: string;
  accountName: string;
  accountLedger: string | null;
}
export interface TypeListRailTab {
  id: string;
  txnType: TransactionType;
}

interface Props {
  /** Currently-active tab id (e.g. 'home', 'input', 'tb', or a dynamic tab id). */
  activeTab: string;
  onSelectTab: (id: string) => void;
  onAction: (type: TransactionType) => void;
  /** Open ledger drill-down tabs — surfaced as their own icons in the rail. */
  ledgerTabs: LedgerRailTab[];
  /** Open transaction-type list tabs (PAY list, REC list, etc.). */
  typeListTabs?: TypeListRailTab[];
  /** Single close handler for any dynamic tab (ledger or type-list). */
  onCloseLedgerTab: (id: string) => void;
  onOpenSettings: () => void;
  /** Disable the action button + tabs that should be unavailable. */
  disabled?: boolean;
  /** Match the page width's safe area. */
  className?: string;
}

export default function BookSideRail({
  activeTab, onSelectTab, onAction, ledgerTabs, typeListTabs = [], onCloseLedgerTab, onOpenSettings,
  disabled, className,
}: Props) {
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

  function railButton({
    id, label, tooltip, icon: Icon, active, onClick, disabled: btnDisabled, accent,
  }: {
    id: string;
    label: string;
    tooltip: string;
    icon: React.ComponentType<{ size?: number; className?: string }>;
    active: boolean;
    onClick: () => void;
    disabled?: boolean;
    accent?: 'indigo' | 'emerald';
  }) {
    const accentBg = accent === 'emerald' ? 'bg-emerald-50 text-emerald-700' : 'bg-indigo-50 text-indigo-700';
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
      className={`relative w-14 shrink-0 rounded-xl border border-slate-200 bg-white shadow-sm flex flex-col items-center py-2 ${className ?? ''}`}
    >
      {/* New transaction (popout trigger) */}
      <Tooltip label={disabled ? 'New transaction — book is locked or archived' : 'New transaction'} side="right">
        <button
          ref={newTxnButtonRef}
          type="button"
          onClick={() => !disabled && setActionMenuOpen(o => !o)}
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
        {railButton({
          id: 'input', label: 'Input sheet', tooltip: 'Input sheet',
          icon: Pencil, active: activeTab === 'input',
          onClick: () => onSelectTab('input'),
          disabled,
        })}
        {railButton({
          id: 'tb', label: 'Trial Balance', tooltip: 'Trial Balance',
          icon: Scale, active: activeTab === 'tb',
          onClick: () => onSelectTab('tb'),
        })}
        {railButton({
          id: 'pnl', label: 'Profit and Loss', tooltip: 'Profit and Loss',
          icon: TrendingUp, active: activeTab === 'pnl',
          onClick: () => onSelectTab('pnl'),
        })}
        {railButton({
          id: 'bs', label: 'Balance Sheet', tooltip: 'Balance Sheet',
          icon: Layers, active: activeTab === 'bs',
          onClick: () => onSelectTab('bs'),
        })}
        {railButton({
          id: 'cf', label: 'Cash Flow', tooltip: 'Cash Flow + forecast',
          icon: BadgePoundSterling, active: activeTab === 'cf',
          onClick: () => onSelectTab('cf'),
        })}
        {railButton({
          id: 'vat', label: 'VAT Return', tooltip: 'VAT Return — quarterly 9-box',
          icon: FileSpreadsheet, active: activeTab === 'vat',
          onClick: () => onSelectTab('vat'),
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
      </div>

      {/* Dynamic drill-down tabs — ledger accounts AND transaction-type lists */}
      {(ledgerTabs.length > 0 || typeListTabs.length > 0) && (
        <>
          <div className="w-6 h-px bg-slate-200 my-2" aria-hidden />
          <div className="flex flex-col items-center gap-1 max-h-[40vh] overflow-y-auto w-full px-1">
            {/* Type-list tabs (PAY / SIN / JRN etc.) render first — they're the
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
    </div>
  );
}
