'use client';

/**
 * BalanceSheetTab — formal Balance Sheet "as at" a date with prior year-end
 * comparison.
 *
 * Visual language matches ProfitLossTab — neutral palette, blue hyperlink
 * account names, classic underlined sub-totals.
 *
 * Two figure columns:
 *   • As at <period end> — driven by PeriodSelector
 *   • As at <same date one year earlier>
 */

import { useEffect, useMemo, useState } from 'react';
import { Loader2, Printer, Download, Layers, AlertTriangle } from 'lucide-react';
import PeriodSelector, { type DateRange } from './PeriodSelector';

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
  bookId: string;
  onOpenAccount?: (a: { id: string; name: string; ledger: string | null }) => void;
}

type BsGroup = 'fixed_assets' | 'current_assets' | 'current_liabilities' | 'long_term_liabilities' | 'equity';

function bsGroupOf(ledger: string | null, accountType: AccountBalance['account_type']): BsGroup | null {
  if (!ledger) return null;
  if (accountType === 'income' || accountType === 'expense') return null;
  if (ledger.startsWith('FA ')) return 'fixed_assets';
  if (ledger === 'Investments - fixed') return 'fixed_assets';
  if (ledger === 'Investments - current') return 'current_assets';
  if (ledger === 'Stocks' || ledger === 'Customers' || ledger === 'Debtors' || ledger === 'Bank') return 'current_assets';
  if (ledger === 'Suppliers' || ledger === 'Creditors') return 'current_liabilities';
  if (ledger === 'Deferred tax') return 'long_term_liabilities';
  if (accountType === 'equity') return 'equity';
  return null;
}

const SECTIONS: { key: BsGroup; title: string }[] = [
  { key: 'fixed_assets',          title: 'Fixed assets'          },
  { key: 'current_assets',        title: 'Current assets'        },
  { key: 'current_liabilities',   title: 'Current liabilities'   },
  { key: 'long_term_liabilities', title: 'Long-term liabilities' },
  { key: 'equity',                title: 'Capital and reserves'  },
];

function displayValue(a: AccountBalance): number {
  // Asset → keep sign; liability/equity → flip so credits read positive.
  return (a.account_type === 'liability' || a.account_type === 'equity') ? -a.balance : a.balance;
}

function fmt(n: number): string {
  if (Math.abs(n) < 0.005) return '-';
  const abs = Math.abs(n).toLocaleString('en-GB', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  return n < 0 ? `(${abs})` : abs;
}

function isoOneYearBefore(iso: string): string {
  const d = new Date(iso);
  d.setFullYear(d.getFullYear() - 1);
  return d.toISOString().slice(0, 10);
}

function formatUk(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y.slice(2)}`;
}

async function fetchBalances(bookId: string, asAt: string | null): Promise<AccountBalance[]> {
  const params = new URLSearchParams();
  if (asAt) params.set('to', asAt);
  params.set('include_zero', 'false');
  const r = await fetch(`/api/bookkeeping/books/${bookId}/balances?${params}`);
  if (!r.ok) throw new Error('Failed to load balances');
  const d = await r.json();
  return (d.accounts ?? []) as AccountBalance[];
}

export default function BalanceSheetTab({ bookId, onOpenAccount }: Props) {
  const [period, setPeriod] = useState<DateRange>({ from: null, to: null });
  const [showZero, setShowZero] = useState(false);
  const [current, setCurrent] = useState<AccountBalance[]>([]);
  const [prior, setPrior]     = useState<AccountBalance[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');

  const asAtCurrent = period.to;
  const asAtPrior   = period.to ? isoOneYearBefore(period.to) : null;

  useEffect(() => {
    let cancelled = false;
    async function go() {
      setLoading(true); setError('');
      try {
        const [cur, pri] = await Promise.all([
          fetchBalances(bookId, asAtCurrent),
          asAtPrior ? fetchBalances(bookId, asAtPrior) : Promise.resolve([] as AccountBalance[]),
        ]);
        if (cancelled) return;
        setCurrent(cur);
        setPrior(pri);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void go();
    return () => { cancelled = true; };
  }, [bookId, asAtCurrent, asAtPrior]);

  type Row = { id: string; name: string; ledger: string | null; current: number; prior: number };
  type Section = { key: BsGroup; title: string; rows: Row[]; currentTotal: number; priorTotal: number };

  const sections: Section[] = useMemo(() => {
    return SECTIONS.map(def => {
      const inSection = (acc: AccountBalance[]) => acc.filter(a => bsGroupOf(a.ledger, a.account_type) === def.key);
      const cur = inSection(current);
      const pri = inSection(prior);
      const idMap = new Map<string, { name: string; ledger: string | null; current: number; prior: number }>();
      for (const a of cur) {
        idMap.set(a.id, { name: a.name, ledger: a.ledger, current: displayValue(a), prior: 0 });
      }
      for (const a of pri) {
        const entry = idMap.get(a.id) ?? { name: a.name, ledger: a.ledger, current: 0, prior: 0 };
        entry.prior = displayValue(a);
        idMap.set(a.id, entry);
      }
      const rows: Row[] = [...idMap.entries()]
        .map(([id, v]) => ({ id, ...v }))
        .filter(r => showZero || Math.abs(r.current) >= 0.005 || Math.abs(r.prior) >= 0.005)
        .sort((a, b) => {
          const ledgerCmp = (a.ledger ?? '').localeCompare(b.ledger ?? '');
          if (ledgerCmp !== 0) return ledgerCmp;
          return a.name.localeCompare(b.name);
        });
      const currentTotal = rows.reduce((s, r) => s + r.current, 0);
      const priorTotal   = rows.reduce((s, r) => s + r.prior,   0);
      return { key: def.key, title: def.title, rows, currentTotal, priorTotal };
    });
  }, [current, prior, showZero]);

  const totals = useMemo(() => {
    const get = (key: BsGroup) => sections.find(s => s.key === key)!;
    const totalAssets       = get('fixed_assets').currentTotal + get('current_assets').currentTotal;
    const totalLiabilities  = get('current_liabilities').currentTotal + get('long_term_liabilities').currentTotal;
    const netAssets         = totalAssets - totalLiabilities;
    const totalCapital      = get('equity').currentTotal;
    const balanceCheck      = +(netAssets - totalCapital).toFixed(2);
    const priorAssets       = get('fixed_assets').priorTotal + get('current_assets').priorTotal;
    const priorLiabilities  = get('current_liabilities').priorTotal + get('long_term_liabilities').priorTotal;
    const priorNetAssets    = priorAssets - priorLiabilities;
    const priorCapital      = get('equity').priorTotal;
    return {
      totalAssets, totalLiabilities, netAssets, totalCapital, balanceCheck,
      priorAssets, priorLiabilities, priorNetAssets, priorCapital,
    };
  }, [sections]);

  const hasMovement = sections.some(s => s.rows.length > 0);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 flex-wrap">
        <PeriodSelector bookId={bookId} value={period} onChange={setPeriod} />
        <label className="text-xs text-slate-600 inline-flex items-center gap-1.5 ml-auto">
          <input type="checkbox" checked={showZero} onChange={e => setShowZero(e.target.checked)} className="rounded border-slate-300" />
          Show zero-balance accounts
        </label>
        <button
          type="button"
          onClick={() => window.print()}
          className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700"
        >
          <Printer size={12} /> Print
        </button>
        <button
          type="button"
          disabled
          className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-400 cursor-not-allowed"
        >
          <Download size={12} /> Export
        </button>
      </div>

      {Math.abs(totals.balanceCheck) > 0.05 && hasMovement && (
        <div className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 inline-flex items-center gap-2">
          <AlertTriangle size={13} /> Net assets and Capital don&apos;t agree by {fmt(totals.balanceCheck)} — usually means a missing opening balance or an incomplete period.
        </div>
      )}

      {error && (
        <div className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">{error}</div>
      )}

      {loading && current.length === 0 ? (
        <div className="flex items-center justify-center py-10 text-gray-400 text-sm">
          <Loader2 size={14} className="animate-spin mr-2" /> Loading…
        </div>
      ) : !hasMovement ? (
        <div className="text-center py-10 px-6 border border-slate-200 rounded-xl bg-white shadow-sm">
          <div className="inline-flex items-center justify-center w-10 h-10 rounded-lg bg-indigo-50 text-indigo-600 mb-2">
            <Layers size={16} />
          </div>
          <p className="text-sm font-medium text-slate-900 mb-0.5">Nothing on the balance sheet yet</p>
          <p className="text-xs text-slate-500">Post some transactions or opening balances and they&apos;ll show here.</p>
        </div>
      ) : (
        <div className="border border-slate-200 rounded-xl overflow-hidden bg-white shadow-sm">
          <table className="w-full text-sm">
            <colgroup>
              <col />
              <col className="w-40" />
              <col className="w-40" />
            </colgroup>
            <thead>
              <tr>
                <th />
                <th className="px-6 py-3 text-right">
                  <div className="text-xs font-semibold text-slate-700">As at {asAtCurrent ? formatUk(asAtCurrent) : '—'}</div>
                  <div className="text-[11px] text-slate-400 font-normal">£</div>
                </th>
                <th className="px-6 py-3 text-right">
                  <div className="text-xs font-semibold text-slate-700">{asAtPrior ? `As at ${formatUk(asAtPrior)}` : '—'}</div>
                  <div className="text-[11px] text-slate-400 font-normal">£</div>
                </th>
              </tr>
            </thead>
            <tbody>
              {/* Assets */}
              {(sections[0].rows.length > 0 || sections[1].rows.length > 0) && (
                <>
                  <BsTitle title="Assets" />
                  <BsSection section={sections[0]} onOpenAccount={onOpenAccount} />
                  <BsSection section={sections[1]} onOpenAccount={onOpenAccount} />
                  <BsSubtotal label="Total assets" current={totals.totalAssets} prior={totals.priorAssets} />
                </>
              )}

              {/* Liabilities */}
              {(sections[2].rows.length > 0 || sections[3].rows.length > 0) && (
                <>
                  <BsTitle title="Liabilities" />
                  <BsSection section={sections[2]} onOpenAccount={onOpenAccount} />
                  <BsSection section={sections[3]} onOpenAccount={onOpenAccount} />
                  <BsSubtotal label="Total liabilities" current={totals.totalLiabilities} prior={totals.priorLiabilities} />
                </>
              )}

              {/* Net assets */}
              <tr className="border-t-2 border-slate-300">
                <td className="px-6 py-3 font-semibold text-slate-900">Net assets</td>
                <td className="px-6 py-3 text-right tabular-nums font-bold text-slate-900">{fmt(totals.netAssets)}</td>
                <td className="px-6 py-3 text-right tabular-nums font-bold text-slate-900">{fmt(totals.priorNetAssets)}</td>
              </tr>

              {/* Capital and reserves */}
              {sections[4].rows.length > 0 && (
                <>
                  <BsTitle title="Capital and reserves" />
                  <BsSection section={sections[4]} onOpenAccount={onOpenAccount} hideSectionLabel />
                  <tr className="border-t-2 border-slate-300">
                    <td className="px-6 py-3 font-semibold text-slate-900">Total capital and reserves</td>
                    <td className="px-6 py-3 text-right tabular-nums font-bold text-slate-900">{fmt(totals.totalCapital)}</td>
                    <td className="px-6 py-3 text-right tabular-nums font-bold text-slate-900">{fmt(totals.priorCapital)}</td>
                  </tr>
                </>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );

  function BsTitle({ title }: { title: string }) {
    return (
      <tr>
        <td colSpan={3} className="px-6 pt-4 pb-1 font-semibold text-slate-900">{title}</td>
      </tr>
    );
  }

  function BsSection({ section, onOpenAccount, hideSectionLabel }: {
    section: Section;
    onOpenAccount?: Props['onOpenAccount'];
    hideSectionLabel?: boolean;
  }) {
    if (section.rows.length === 0) return null;
    return (
      <>
        {!hideSectionLabel && (
          <tr>
            <td colSpan={3} className="px-6 pt-2 pb-0.5 pl-10 text-[11px] uppercase tracking-wide font-medium text-slate-500">{section.title}</td>
          </tr>
        )}
        {section.rows.map(r => (
          <tr key={r.id} className="hover:bg-slate-50">
            <td className="px-6 py-1 pl-14">
              {onOpenAccount ? (
                <button
                  type="button"
                  onClick={() => onOpenAccount({ id: r.id, name: r.name, ledger: r.ledger })}
                  className="text-indigo-700 hover:underline text-left"
                >
                  {r.name}
                </button>
              ) : (
                <span className="text-indigo-700">{r.name}</span>
              )}
            </td>
            <td className="px-6 py-1 text-right tabular-nums text-slate-700">{fmt(r.current)}</td>
            <td className="px-6 py-1 text-right tabular-nums text-slate-700">{fmt(r.prior)}</td>
          </tr>
        ))}
        <tr>
          <td className="px-6 py-1" />
          <td className="px-6 py-1 text-right tabular-nums text-slate-900 border-t border-slate-300">{fmt(section.currentTotal)}</td>
          <td className="px-6 py-1 text-right tabular-nums text-slate-900 border-t border-slate-300">{fmt(section.priorTotal)}</td>
        </tr>
      </>
    );
  }

  function BsSubtotal({ label, current, prior }: { label: string; current: number; prior: number }) {
    return (
      <tr>
        <td className="px-6 py-1.5 text-slate-900 font-medium">{label}</td>
        <td className="px-6 py-1.5 text-right tabular-nums text-slate-900 font-semibold border-t border-slate-400">{fmt(current)}</td>
        <td className="px-6 py-1.5 text-right tabular-nums text-slate-900 font-semibold border-t border-slate-400">{fmt(prior)}</td>
      </tr>
    );
  }
}
