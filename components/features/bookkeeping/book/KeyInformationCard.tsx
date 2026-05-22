'use client';

/**
 * KeyInformationCard — the at-a-glance balances panel on the Home tab.
 *
 * VT equivalent: the "Key information" / "Net profit" / "Net assets" /
 * "Ledgers" tabs at the bottom of the Home Page card. Same data, four
 * different slices — sub-tabs sit at the BOTTOM of the card so the data
 * lives where the eye lands first.
 *
 * Data comes from /api/bookkeeping/books/[id]/balances?include_zero=true.
 * We aggregate per ledger client-side for the Ledgers tab.
 */

import { useEffect, useMemo, useState } from 'react';
import { Loader2, BarChart3, Wallet, Users, Building2, FileBadge, CalendarRange, TrendingUp, TrendingDown, Layers } from 'lucide-react';
import { LedgerLink } from './BookNavigationContext';
import type { Book, VatScheme } from '@/types/bookkeeping';
import { VAT_SCHEME_LABEL } from '@/types/bookkeeping';

interface AccountBalance {
  id: string;
  name: string;
  ledger: string | null;
  account_type: 'asset' | 'liability' | 'equity' | 'income' | 'expense';
  debit_total: number;
  credit_total: number;
  balance: number;
}

interface Props {
  book: Book;
  /** Bumped by parent when transactions change so we refetch. */
  refreshKey?: number;
  /** Override the card's wrapper class — used by BookHomeTab to share a fixed
   *  height with the stacked Quick Actions card. */
  className?: string;
}

type SubTab = 'key' | 'profit' | 'assets' | 'ledgers';

const SUB_TABS: { id: SubTab; label: string }[] = [
  { id: 'key',     label: 'Key items'  },
  { id: 'profit',  label: 'Net profit' },
  { id: 'assets',  label: 'Net assets' },
  { id: 'ledgers', label: 'Ledgers'    },
];

// Tailwind-safe per-account-type chip styles
const TYPE_CHIP: Record<AccountBalance['account_type'], string> = {
  income:    'text-emerald-700 bg-emerald-50 border-emerald-100',
  expense:   'text-rose-700    bg-rose-50    border-rose-100',
  asset:     'text-blue-700    bg-blue-50    border-blue-100',
  liability: 'text-violet-700  bg-violet-50  border-violet-100',
  equity:    'text-slate-700   bg-slate-100  border-slate-200',
};

function fmt(n: number): string {
  // Bracket negatives in true accountant style: (1,234.56)
  const abs = Math.abs(n).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return n < 0 ? `(${abs})` : abs;
}

export default function KeyInformationCard({ book, refreshKey, className }: Props) {
  const [tab, setTab] = useState<SubTab>('key');
  const [accounts, setAccounts] = useState<AccountBalance[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Load all balances. We use include_zero=false to keep the response tight —
  // accounts with no movement add no signal here.
  useEffect(() => {
    let cancelled = false;
    async function go() {
      setLoading(true); setError('');
      try {
        const r = await fetch(`/api/bookkeeping/books/${book.id}/balances`);
        if (!r.ok) {
          const d = await r.json().catch(() => ({}));
          throw new Error(d.error ?? 'Failed to load balances');
        }
        const d = await r.json();
        if (!cancelled) setAccounts((d.accounts ?? []) as AccountBalance[]);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void go();
    return () => { cancelled = true; };
  }, [book.id, refreshKey]);

  // ── Derived figures ──────────────────────────────────────────────────────
  // For asset/expense accounts, balance is naturally positive (Dr).
  // For income/liability/equity, balance is naturally negative — we flip the
  // sign for display so figures read positive on their natural side.
  function displayBalance(a: AccountBalance): number {
    if (a.account_type === 'asset' || a.account_type === 'expense') return a.balance;
    return -a.balance; // income/liability/equity
  }

  // Aggregate by ledger.
  const byLedger = useMemo(() => {
    const m = new Map<string, { ledger: string; account_type: AccountBalance['account_type']; total: number }>();
    for (const a of accounts) {
      const key = a.ledger ?? '— Ungrouped';
      const entry = m.get(key) ?? { ledger: key, account_type: a.account_type, total: 0 };
      entry.total += displayBalance(a);
      m.set(key, entry);
    }
    return [...m.values()].sort((a, b) => a.ledger.localeCompare(b.ledger));
  }, [accounts]);

  const bankTotal      = useMemo(() => sumByLedger(accounts, 'Bank'), [accounts]);
  const customersTotal = useMemo(() => sumByLedger(accounts, 'Customers'), [accounts]);
  const suppliersTotal = useMemo(() => sumByLedger(accounts, 'Suppliers'), [accounts]);

  const totals = useMemo(() => {
    let income = 0, expense = 0, asset = 0, liability = 0, equity = 0;
    for (const a of accounts) {
      const v = displayBalance(a);
      if (a.account_type === 'income')    income += v;
      if (a.account_type === 'expense')   expense += v;
      if (a.account_type === 'asset')     asset += v;
      if (a.account_type === 'liability') liability += v;
      if (a.account_type === 'equity')    equity += v;
    }
    return { income, expense, asset, liability, equity };
  }, [accounts]);

  const netProfit = +(totals.income - totals.expense).toFixed(2);
  const netAssets = +(totals.asset - totals.liability).toFixed(2);

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div className={`rounded-xl border border-slate-200 bg-white shadow-sm flex flex-col ${className ?? ''}`}>
      {/* Card header */}
      <div className="px-4 pt-3 pb-2 flex items-center gap-2 border-b border-slate-100 shrink-0">
        <div className="w-7 h-7 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center">
          <BarChart3 size={14} />
        </div>
        <h3 className="text-sm font-semibold text-slate-900">Key Information</h3>
        {loading && <Loader2 size={12} className="animate-spin text-slate-400 ml-auto" />}
      </div>

      {/* Content — scrollable so a tall ledger list inside a height-constrained
          card doesn't overflow the wrapper. */}
      <div className="flex-1 overflow-y-auto min-h-0 px-4 py-3">
        {error ? (
          <div className="text-xs text-rose-700 bg-rose-50 border border-rose-100 rounded-lg px-3 py-2">
            {error}
          </div>
        ) : tab === 'key' ? (
          <KeyItemsView
            bankTotal={bankTotal}
            customersTotal={customersTotal}
            suppliersTotal={suppliersTotal}
            vatRegistered={book.vat_registered}
            vatScheme={book.vat_scheme}
          />
        ) : tab === 'profit' ? (
          <NetProfitView income={totals.income} expense={totals.expense} netProfit={netProfit} />
        ) : tab === 'assets' ? (
          <NetAssetsView asset={totals.asset} liability={totals.liability} equity={totals.equity} netAssets={netAssets} />
        ) : (
          <LedgersView byLedger={byLedger} />
        )}
      </div>

      {/* Sub-tabs at the BOTTOM */}
      <div className="border-t border-slate-100 px-2 py-1.5 flex items-center gap-1 overflow-x-auto shrink-0">
        {SUB_TABS.map(s => (
          <button
            key={s.id}
            onClick={() => setTab(s.id)}
            className={`text-[11px] px-2.5 py-1 rounded-md border transition-colors whitespace-nowrap ${
              tab === s.id
                ? 'bg-blue-50 text-blue-700 border-blue-200'
                : 'text-slate-500 border-transparent hover:bg-slate-50 hover:text-slate-700'
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Subviews ─────────────────────────────────────────────────────────────────

function sumByLedger(accounts: AccountBalance[], ledger: string): number {
  // Display-positive sum for the named ledger.
  return accounts
    .filter(a => a.ledger === ledger)
    .reduce((s, a) => {
      const v = (a.account_type === 'asset' || a.account_type === 'expense') ? a.balance : -a.balance;
      return s + v;
    }, 0);
}

interface Row { label: React.ReactNode; value: string; icon?: React.ComponentType<{ size?: number; className?: string }>; tone?: 'default' | 'positive' | 'negative' }

function DataRow({ label, value, icon: Icon, tone = 'default' }: Row) {
  const toneClass =
    tone === 'positive' ? 'text-emerald-700' :
    tone === 'negative' ? 'text-rose-700' :
    'text-slate-900';
  return (
    <div className="flex items-center justify-between gap-3 py-1.5 border-b border-slate-50 last:border-b-0">
      <div className="flex items-center gap-2 text-xs text-slate-600">
        {Icon && (
          <span className="w-5 h-5 rounded bg-slate-50 text-slate-500 flex items-center justify-center shrink-0">
            <Icon size={11} />
          </span>
        )}
        <span>{label}</span>
      </div>
      <span className={`text-sm font-semibold tabular-nums ${toneClass}`}>{value}</span>
    </div>
  );
}

function KeyItemsView({
  bankTotal, customersTotal, suppliersTotal, vatRegistered, vatScheme,
}: {
  bankTotal: number; customersTotal: number; suppliersTotal: number;
  vatRegistered: boolean; vatScheme: VatScheme | null;
}) {
  return (
    <div className="space-y-0">
      <DataRow
        icon={Wallet}
        label={<LedgerLink ledger="Bank" className="text-xs">Bank</LedgerLink>}
        value={fmt(bankTotal)}
        tone={bankTotal < 0 ? 'negative' : 'default'}
      />
      <DataRow
        icon={Users}
        label={<LedgerLink ledger="Customers" className="text-xs">Customers</LedgerLink>}
        value={fmt(customersTotal)}
        tone={customersTotal < 0 ? 'negative' : 'default'}
      />
      <DataRow
        icon={Building2}
        label={<LedgerLink ledger="Suppliers" className="text-xs">Suppliers</LedgerLink>}
        value={fmt(suppliersTotal)}
        tone={suppliersTotal < 0 ? 'negative' : 'default'}
      />
      <DataRow
        icon={FileBadge}
        label="VAT registered"
        value={vatRegistered ? (vatScheme ? `Yes · ${VAT_SCHEME_LABEL[vatScheme]}` : 'Yes') : 'No'}
      />
      <DataRow
        icon={CalendarRange}
        label="Last VAT return"
        value="—"
      />
    </div>
  );
}

function NetProfitView({ income, expense, netProfit }: { income: number; expense: number; netProfit: number }) {
  return (
    <div className="space-y-0">
      <DataRow icon={TrendingUp}   label="Income"     value={fmt(income)}    tone={income > 0 ? 'positive' : 'default'} />
      <DataRow icon={TrendingDown} label="Expenses"   value={fmt(expense)}   tone={expense > 0 ? 'negative' : 'default'} />
      <div className="pt-2 mt-1 border-t border-slate-100">
        <DataRow
          label="Net profit (period to date)"
          value={fmt(netProfit)}
          tone={netProfit > 0 ? 'positive' : netProfit < 0 ? 'negative' : 'default'}
        />
      </div>
    </div>
  );
}

function NetAssetsView({ asset, liability, equity, netAssets }: { asset: number; liability: number; equity: number; netAssets: number }) {
  return (
    <div className="space-y-0">
      <DataRow label="Assets"      value={fmt(asset)}     tone={asset     > 0 ? 'positive' : 'default'} />
      <DataRow label="Liabilities" value={fmt(liability)} tone={liability > 0 ? 'negative' : 'default'} />
      <DataRow label="Equity"      value={fmt(equity)} />
      <div className="pt-2 mt-1 border-t border-slate-100">
        <DataRow
          label="Net assets (Assets − Liabilities)"
          value={fmt(netAssets)}
          tone={netAssets > 0 ? 'positive' : netAssets < 0 ? 'negative' : 'default'}
        />
      </div>
    </div>
  );
}

function LedgersView({ byLedger }: { byLedger: { ledger: string; account_type: AccountBalance['account_type']; total: number }[] }) {
  if (byLedger.length === 0) {
    return <p className="text-xs text-slate-400 italic">No movement yet — post a transaction to see ledger balances appear.</p>;
  }
  return (
    <div className="space-y-0 max-h-56 overflow-y-auto pr-1">
      {byLedger.map(l => (
        <div key={l.ledger} className="flex items-center justify-between gap-3 py-1.5 border-b border-slate-50 last:border-b-0">
          <div className="flex items-center gap-2 min-w-0">
            <Layers size={11} className="text-slate-400 shrink-0" />
            <LedgerLink ledger={l.ledger} className="text-xs truncate">{l.ledger}</LedgerLink>
            <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-semibold uppercase tracking-wide border ${TYPE_CHIP[l.account_type]}`}>
              {l.account_type}
            </span>
          </div>
          <span className={`text-sm font-semibold tabular-nums shrink-0 ${
            l.total > 0 ? 'text-slate-900' : l.total < 0 ? 'text-rose-700' : 'text-slate-400'
          }`}>
            {fmt(l.total)}
          </span>
        </div>
      ))}
    </div>
  );
}
