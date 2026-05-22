'use client';

/**
 * ProfitLossTab — formal P&L with prior-period comparison.
 *
 * Visual language: neutral "proper accountant's report" — no shaded section
 * backgrounds, no coloured chips. Account names are hyperlinked (blue);
 * sub-totals are underlined with a top border; Net profit lives in a bold
 * row at the bottom of the table.
 *
 * Two figure columns:
 *   • Current period — driven by PeriodSelector
 *   • Prior period   — auto-computed as the same length immediately before
 */

import { useEffect, useMemo, useState } from 'react';
import { Loader2, Printer, Download, FileBarChart2 } from 'lucide-react';
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

// P&L-relevant ledgers grouped into the four sections we display.
const PL_SECTIONS: { ledger: string; title: string }[] = [
  { ledger: 'Income',        title: 'Income'        },
  { ledger: 'Cost of sales', title: 'Cost of sales' },
  { ledger: 'Expenses',      title: 'Expenses'      },
  { ledger: 'Taxation',      title: 'Taxation'      },
];

function isoDayBefore(iso: string): string {
  const d = new Date(iso);
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((new Date(toIso).getTime() - new Date(fromIso).getTime()) / 86_400_000);
}

function computePriorPeriod(current: DateRange): DateRange {
  if (!current.from || !current.to) return { from: null, to: null };
  const lengthDays = daysBetween(current.from, current.to) + 1;
  const priorTo = isoDayBefore(current.from);
  const priorFromD = new Date(priorTo);
  priorFromD.setDate(priorFromD.getDate() - (lengthDays - 1));
  return { from: priorFromD.toISOString().slice(0, 10), to: priorTo };
}

function displayValue(a: AccountBalance): number {
  // Income flips sign so credits read positive; expenses keep their natural sign.
  return a.account_type === 'income' ? -a.balance : a.balance;
}

function fmt(n: number): string {
  if (Math.abs(n) < 0.005) return '-';
  const abs = Math.abs(n).toLocaleString('en-GB', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  return n < 0 ? `(${abs})` : abs;
}

async function fetchBalances(bookId: string, range: DateRange): Promise<AccountBalance[]> {
  const params = new URLSearchParams();
  if (range.from) params.set('from', range.from);
  if (range.to)   params.set('to',   range.to);
  const r = await fetch(`/api/bookkeeping/books/${bookId}/balances?${params}`);
  if (!r.ok) throw new Error('Failed to load balances');
  const d = await r.json();
  return (d.accounts ?? []) as AccountBalance[];
}

function periodHeader(p: DateRange): string {
  if (!p.from && !p.to) return 'All time';
  if (!p.from) return `Up to ${formatUk(p.to!)}`;
  if (!p.to)   return `From ${formatUk(p.from)}`;
  // For year-end-aligned ranges, prefer the year (e.g. "2025")
  if (p.to.endsWith('-12-31')) return p.to.slice(0, 4);
  if (/-0[34]-(30|31)$/.test(p.to)) return p.to.slice(0, 4); // FY end Mar/Apr
  return `${formatUk(p.from)} – ${formatUk(p.to)}`;
}
function formatUk(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y.slice(2)}`;
}

export default function ProfitLossTab({ bookId, onOpenAccount }: Props) {
  const [period, setPeriod] = useState<DateRange>({ from: null, to: null });
  const [current, setCurrent] = useState<AccountBalance[]>([]);
  const [prior, setPrior]     = useState<AccountBalance[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');
  const [showZero, setShowZero] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function go() {
      setLoading(true); setError('');
      try {
        const priorPeriod = computePriorPeriod(period);
        const [cur, pri] = await Promise.all([
          fetchBalances(bookId, period),
          priorPeriod.from && priorPeriod.to
            ? fetchBalances(bookId, priorPeriod)
            : Promise.resolve([] as AccountBalance[]),
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
  }, [bookId, period.from, period.to]);

  const priorPeriod = useMemo(() => computePriorPeriod(period), [period.from, period.to]);

  // ── Build the per-section grouped data ──────────────────────────────────
  type Row = { id: string; name: string; ledger: string | null; current: number; prior: number };
  type Section = { title: string; ledger: string; rows: Row[]; currentTotal: number; priorTotal: number };

  const sections: Section[] = useMemo(() => {
    return PL_SECTIONS.map(def => {
      const inLedger = (acc: AccountBalance[]) => acc.filter(a => a.ledger === def.ledger);
      const cur = inLedger(current);
      const pri = inLedger(prior);
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
        .sort((a, b) => a.name.localeCompare(b.name));
      const currentTotal = rows.reduce((s, r) => s + r.current, 0);
      const priorTotal   = rows.reduce((s, r) => s + r.prior,   0);
      return { title: def.title, ledger: def.ledger, rows, currentTotal, priorTotal };
    });
  }, [current, prior, showZero]);

  const gross     = { current: sections[0].currentTotal - sections[1].currentTotal, prior: sections[0].priorTotal - sections[1].priorTotal };
  const operating = { current: gross.current - sections[2].currentTotal,            prior: gross.prior - sections[2].priorTotal           };
  const net       = { current: operating.current - sections[3].currentTotal,        prior: operating.prior - sections[3].priorTotal       };

  const hasMovement = sections.some(s => s.rows.length > 0);

  return (
    <div className="space-y-3">
      {/* Period selector + view options */}
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
          title="Export — coming with the reports polish pass"
          className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-400 cursor-not-allowed"
        >
          <Download size={12} /> Export
        </button>
      </div>

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
            <FileBarChart2 size={16} />
          </div>
          <p className="text-sm font-medium text-slate-900 mb-0.5">Nothing to show yet</p>
          <p className="text-xs text-slate-500">No P&amp;L movement in the selected period. Adjust the dates or post some transactions.</p>
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
                  <div className="text-xs font-semibold text-slate-700">{periodHeader(period)}</div>
                  <div className="text-[11px] text-slate-400 font-normal">£</div>
                </th>
                <th className="px-6 py-3 text-right">
                  <div className="text-xs font-semibold text-slate-700">{periodHeader(priorPeriod)}</div>
                  <div className="text-[11px] text-slate-400 font-normal">£</div>
                </th>
              </tr>
            </thead>
            <tbody>
              {sections.map((s, sIdx) => (
                <PlSection
                  key={s.title}
                  section={s}
                  onOpenAccount={onOpenAccount}
                  showSubtotalAfter={sIdx === 1 || sIdx === 2}
                  subtotalRow={
                    sIdx === 1 ? { label: 'Gross profit',     ...gross } :
                    sIdx === 2 ? { label: 'Operating profit', ...operating } :
                    null
                  }
                />
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-slate-300">
                <td className="px-6 py-3 font-semibold text-slate-900">Net profit</td>
                <td className="px-6 py-3 text-right tabular-nums font-bold text-slate-900">{fmt(net.current)}</td>
                <td className="px-6 py-3 text-right tabular-nums font-bold text-slate-900">{fmt(net.prior)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );

  function PlSection({
    section, showSubtotalAfter, subtotalRow, onOpenAccount,
  }: {
    section: Section;
    showSubtotalAfter: boolean;
    subtotalRow: { label: string; current: number; prior: number } | null;
    onOpenAccount?: Props['onOpenAccount'];
  }) {
    if (section.rows.length === 0) return null;
    return (
      <>
        {/* Section title */}
        <tr>
          <td colSpan={3} className="px-6 pt-4 pb-1 font-semibold text-slate-900">{section.title}</td>
        </tr>
        {/* Account rows */}
        {section.rows.map(r => (
          <tr key={r.id} className="hover:bg-slate-50">
            <td className="px-6 py-1 pl-10">
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
        {/* Section sub-total with the classic underline-above effect */}
        <tr>
          <td className="px-6 py-1" />
          <td className="px-6 py-1 text-right tabular-nums text-slate-900 border-t border-slate-300">{fmt(section.currentTotal)}</td>
          <td className="px-6 py-1 text-right tabular-nums text-slate-900 border-t border-slate-300">{fmt(section.priorTotal)}</td>
        </tr>
        {/* Optional Gross / Operating profit sub-totals shown after CoS / Expenses */}
        {showSubtotalAfter && subtotalRow && (
          <tr>
            <td className="px-6 py-1" />
            <td className="px-6 py-1 text-right tabular-nums text-slate-900 border-t border-slate-300 font-semibold">{fmt(subtotalRow.current)}</td>
            <td className="px-6 py-1 text-right tabular-nums text-slate-900 border-t border-slate-300 font-semibold">{fmt(subtotalRow.prior)}</td>
          </tr>
        )}
      </>
    );
  }
}
