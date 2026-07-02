'use client';

/**
 * FinancialSnapshot — the client Overview "Financial Snapshot" panel, wired to
 * the client's bookkeeping book.
 *
 * Compact card: two tabs (P&L · Balance Sheet) showing headline figures for the
 * latest CLOSED financial year — or the current year (flagged "In progress")
 * when nothing has been closed yet. A footer links straight into the book and
 * an expand button opens a lightbox with the full formatted statements (the
 * real ProfitLossTab / BalanceSheetTab, reused via a pinned BookNavigation
 * context so they render for the snapshot's period).
 *
 * Data: GET /api/clients/[id]/financials.
 */

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { Wallet, Lock, Loader2, Maximize2, X, ExternalLink } from 'lucide-react';
import { formatMoneyOrDash } from '@/lib/bookkeeping/formatMoney';
import { useModules } from '@/components/ui/ModulesProvider';
import { canAccessBookkeeping } from '@/lib/bookkeeping/access';
import { BookNavigationProvider, type BookNavigation } from '@/components/features/bookkeeping/book/BookNavigationContext';
import ProfitLossTab from '@/components/features/bookkeeping/reports/ProfitLossTab';
import BalanceSheetTab from '@/components/features/bookkeeping/reports/BalanceSheetTab';

type Tab = 'pnl' | 'bs';

interface Financials {
  hasBook: boolean;
  hasPeriod?: boolean;
  bookId?: string;
  bookName?: string;
  status?: 'closed' | 'provisional';
  period?: { fromIso: string; toIso: string; endLabel: string; label: string };
  pnl?: { turnover: number; costOfSales: number; grossProfit: number; totalExpenses: number; netProfit: number };
  bs?: { totalAssets: number; totalLiabilities: number; netAssets: number; capitalReserves: number };
}

export default function FinancialSnapshot({ clientId }: { clientId: string }) {
  // Gate with the SAME rule the API uses (canAccessBookkeeping) rather than
  // isModuleActive — the two differ for an unprovisioned (empty) module list,
  // where the API grants access but isModuleActive would report false.
  const { activeModules } = useModules();
  const hasBookkeeping = canAccessBookkeeping(activeModules);
  const [data, setData] = useState<Financials | null>(null);
  const [error, setError] = useState(false);
  const [tab, setTab] = useState<Tab>('pnl');
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!hasBookkeeping) return;
    let active = true;
    setData(null); setError(false);
    fetch(`/api/clients/${clientId}/financials`)
      .then(r => (r.ok ? r.json() : Promise.reject()))
      .then(d => { if (active) setData(d as Financials); })
      .catch(() => { if (active) setError(true); });
    return () => { active = false; };
  }, [clientId, hasBookkeeping]);

  const body = (() => {
    if (!hasBookkeeping) return <Centered icon={<Lock size={20} />} title="Bookkeeping not enabled" sub="Enable the Bookkeeping tool to see financials here." />;
    if (error) return <Centered icon={<Wallet size={20} />} title="Couldn't load financials" />;
    if (!data) return <div className="h-full flex items-center justify-center"><Loader2 size={16} className="animate-spin text-[var(--text-muted)]" /></div>;
    if (!data.hasBook) return <Centered icon={<Wallet size={20} />} title="No bookkeeping book" sub="Create a book for this client in the Bookkeeping tool to see their P&L and Balance Sheet." />;
    if (!data.hasPeriod || !data.period) return <Centered icon={<Wallet size={20} />} title="No year-end set" sub="Set a year-end on the book to see period statements." />;
    return <Figures tab={tab} data={data} />;
  })();

  const canExpand = !!(data?.hasPeriod && data.bookId);
  const deepLink = data?.bookId ? `/bookkeeping/${data.bookId}?tab=${tab}` : null;

  return (
    <div className="glass rounded-xl p-5 h-[320px] flex flex-col">
      {/* Header: title + P&L/BS tabs */}
      <div className="flex items-center justify-between mb-3 shrink-0 gap-2">
        <span className="text-sm font-semibold text-[var(--text-primary)]">Financial Snapshot</span>
        {canExpand && (
          <div className="flex items-center gap-1 rounded-lg bg-[var(--accent-light)] p-0.5">
            <TabBtn active={tab === 'pnl'} onClick={() => setTab('pnl')}>P&amp;L</TabBtn>
            <TabBtn active={tab === 'bs'} onClick={() => setTab('bs')}>Balance Sheet</TabBtn>
          </div>
        )}
      </div>

      {/* Period + status line */}
      {data?.hasPeriod && data.period && (
        <div className="flex items-center gap-2 mb-2 shrink-0">
          <span className="text-xs text-[var(--text-muted)]">{data.period.label}</span>
          {data.status === 'closed'
            ? <span className="text-[10px] uppercase tracking-wide font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded">Closed</span>
            : <span className="text-[10px] uppercase tracking-wide font-semibold text-amber-700 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded">In progress</span>}
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin -mx-1 px-1">{body}</div>

      {/* Footer actions */}
      {canExpand && (
        <div className="flex items-center justify-between pt-3 mt-1 border-t border-[var(--border-card)] shrink-0">
          {deepLink && (
            <Link href={deepLink} className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--accent)] hover:underline">
              Open in Bookkeeping <ExternalLink size={12} />
            </Link>
          )}
          <button
            type="button"
            onClick={() => setExpanded(true)}
            className="inline-flex items-center gap-1.5 text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)]"
          >
            <Maximize2 size={12} /> Expand
          </button>
        </div>
      )}

      {expanded && canExpand && data?.bookId && data.period && (
        <StatementLightbox
          bookId={data.bookId}
          bookName={data.bookName ?? 'Bookkeeping'}
          period={data.period}
          initialTab={tab}
          onClose={() => setExpanded(false)}
        />
      )}
    </div>
  );
}

// ── Compact headline figures ────────────────────────────────────────────────
function Figures({ tab, data }: { tab: Tab; data: Financials }) {
  if (tab === 'pnl' && data.pnl) {
    const p = data.pnl;
    const showGross = Math.abs(p.costOfSales) >= 0.005;
    return (
      <dl className="space-y-1">
        <Row label="Turnover" value={p.turnover} />
        {showGross && <Row label="Gross profit" value={p.grossProfit} />}
        <Row label="Total expenses" value={p.totalExpenses} />
        <Row label="Net profit" value={p.netProfit} emphasis />
      </dl>
    );
  }
  if (tab === 'bs' && data.bs) {
    const b = data.bs;
    return (
      <dl className="space-y-1">
        <Row label="Total assets" value={b.totalAssets} />
        <Row label="Total liabilities" value={b.totalLiabilities} />
        <Row label="Net assets" value={b.netAssets} emphasis />
        <Row label="Capital & reserves" value={b.capitalReserves} />
      </dl>
    );
  }
  return null;
}

function Row({ label, value, emphasis }: { label: string; value: number; emphasis?: boolean }) {
  const isZero = Math.abs(value) < 0.005;
  return (
    <div className={`flex items-center justify-between gap-3 py-1.5 ${emphasis ? 'border-t border-[var(--border-card)] mt-1 pt-2.5' : ''}`}>
      <dt className={`text-sm ${emphasis ? 'font-semibold text-[var(--text-primary)]' : 'text-[var(--text-secondary)]'}`}>{label}</dt>
      <dd className={`text-sm tabular-nums ${emphasis ? 'font-bold text-[var(--text-primary)]' : 'font-medium text-[var(--text-primary)]'}`}>
        {isZero ? '—' : `£${formatMoneyOrDash(value)}`}
      </dd>
    </div>
  );
}

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-xs font-medium px-2.5 py-1 rounded-md transition-colors ${
        active ? 'bg-white text-[var(--accent)] shadow-sm' : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
      }`}
    >
      {children}
    </button>
  );
}

function Centered({ icon, title, sub }: { icon: React.ReactNode; title: string; sub?: string }) {
  return (
    <div className="h-full flex flex-col items-center justify-center py-8 gap-2 text-center">
      <div className="text-[var(--text-muted)] opacity-40">{icon}</div>
      <p className="text-sm font-medium text-[var(--text-secondary)]">{title}</p>
      {sub && <p className="text-xs text-[var(--text-muted)] max-w-[220px]">{sub}</p>}
    </div>
  );
}

// ── Lightbox: full P&L / BS reused from the bookkeeping tool ─────────────────
function StatementLightbox({
  bookId, bookName, period, initialTab, onClose,
}: {
  bookId: string;
  bookName: string;
  period: { fromIso: string; toIso: string; label: string };
  initialTab: Tab;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<Tab>(initialTab);

  const handleKey = useCallback((e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); }, [onClose]);
  useEffect(() => {
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [handleKey]);

  // Pin a BookNavigation context to the snapshot's period so the report tabs
  // render for that year. Account-link / drill-down handlers are no-ops here —
  // the tabs fall back to plain (non-clickable) account names without an
  // onOpenAccount prop, so nothing dead-ends.
  const nav: BookNavigation = {
    bookId,
    openAccount: () => {},
    openTypeList: () => {},
    openLedger: () => {},
    activePeriod: {
      ready: true,
      fromIso: period.fromIso,
      toIso: period.toIso,
      fyStartIso: period.fromIso,
      fyEndIso: period.toIso,
      label: period.label,
    },
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 sm:p-8 bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Financial statements"
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-3 border-b border-slate-200 shrink-0">
          <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-0.5">
            <LbTab active={tab === 'pnl'} onClick={() => setTab('pnl')}>Profit &amp; Loss</LbTab>
            <LbTab active={tab === 'bs'} onClick={() => setTab('bs')}>Balance Sheet</LbTab>
          </div>
          <span className="text-sm text-slate-500 truncate ml-1">{bookName}</span>
          <Link
            href={`/bookkeeping/${bookId}?tab=${tab}`}
            className="ml-auto inline-flex items-center gap-1.5 text-xs font-medium text-indigo-600 hover:underline shrink-0"
          >
            Open in Bookkeeping <ExternalLink size={12} />
          </Link>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 shrink-0"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body — the real report tabs, pinned to the snapshot period */}
        <div className="flex-1 min-h-0 overflow-y-auto p-5">
          <BookNavigationProvider value={nav}>
            {tab === 'pnl'
              ? <ProfitLossTab bookId={bookId} />
              : <BalanceSheetTab bookId={bookId} />}
          </BookNavigationProvider>
        </div>
      </div>
    </div>
  );
}

function LbTab({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-xs font-medium px-3 py-1.5 rounded-md transition-colors ${
        active ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'
      }`}
    >
      {children}
    </button>
  );
}
