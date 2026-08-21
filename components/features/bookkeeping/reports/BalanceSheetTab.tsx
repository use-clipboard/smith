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

import { useEffect, useMemo, useRef, useState } from 'react';
import { printReport } from './printReport';
import { exportRowsAsCsv, type CsvRow } from './exportReportCsv';
import { AccountCodeTag } from '@/lib/bookkeeping/useAccountCodes';
import { Loader2, Printer, Download, Layers, AlertTriangle } from 'lucide-react';
import { type DateRange } from './PeriodSelector';
import PeriodEmptyState from './PeriodEmptyState';
import ReportPrintHeader from './ReportPrintHeader';
import { useBookNavigation } from '../book/BookNavigationContext';

interface AccountBalance {
  id: string;
  name: string;
  ledger: string | null;
  account_type: 'asset' | 'liability' | 'equity' | 'income' | 'expense';
  code?: string | null;
  debit_total: number;
  credit_total: number;
  balance: number;
}

interface Props {
  bookId: string;
  onOpenAccount?: (a: { id: string; name: string; ledger: string | null; code?: string | null }) => void;
  /** Rendered inside the Management Accounts pack. Suppresses this tab's own
   *  toolbar (print/export/show-zero) and print header + drops the competing
   *  print root, so the parent owns a single print root + pack header. The
   *  statement table itself is unchanged. */
  embedded?: boolean;
  /** Reports the report's CSV rows up to a parent (the MA pack's Excel export
   *  collects them). Fires whenever the figures change. */
  onCsvRows?: (rows: CsvRow[]) => void;
}

type BsGroup = 'fixed_assets' | 'current_assets' | 'current_liabilities' | 'long_term_liabilities' | 'equity';

function bsGroupOf(ledger: string | null, accountType: AccountBalance['account_type']): BsGroup | null {
  // P&L accounts never appear on the BS (their balance closes to RE via YET).
  if (accountType === 'income' || accountType === 'expense') return null;

  // Ledger-name hints first — keeps the canonical VT ledger names in the
  // "right" bucket regardless of how their account_type is tagged.
  if (ledger) {
    const lc = ledger.toLowerCase();
    if (ledger.startsWith('FA ') || lc.startsWith('fa ') || lc.includes('fixed asset')) return 'fixed_assets';
    if (ledger === 'Investments - fixed') return 'fixed_assets';
    if (ledger === 'Investments - current') return 'current_assets';
    if (['Stocks', 'Customers', 'Debtors', 'Bank'].includes(ledger)) return 'current_assets';
    if (lc.includes('petty cash') || lc === 'cash') return 'current_assets';
    if (['Suppliers', 'Creditors'].includes(ledger)) return 'current_liabilities';
    if (ledger === 'Deferred tax') return 'long_term_liabilities';
    if (lc.includes('long-term') || lc.includes('long term') || lc.includes('loan')) return 'long_term_liabilities';
  }

  // Account-type fallback — covers any custom/imported ledger the hints
  // missed. Without this, asset/liability accounts in an unfamiliar ledger
  // would silently disappear from the BS (which is what was happening for
  // the imported VT book).
  if (accountType === 'asset')     return 'current_assets';
  if (accountType === 'liability') return 'current_liabilities';
  if (accountType === 'equity')    return 'equity';
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

interface BalancesResult {
  accounts: AccountBalance[];
  /** Cumulative net profit over P&L accounts up to `asAt`, INCLUDING any
   *  posted YET. For a closed year this nets to ~0 (the year-end journal has
   *  already transferred it to reserves); for the open year it is the live
   *  profit/(loss) not yet carried to reserves. We surface it as a derived
   *  "Profit/(loss) for the financial year" line so the BS balances without a
   *  posted year-end journal (VT-style dynamic carry). */
  netProfit: number;
}

async function fetchBalances(bookId: string, asAt: string | null, includeZero: boolean): Promise<BalancesResult> {
  const params = new URLSearchParams();
  if (asAt) params.set('to', asAt);
  // Server hides zero-balance accounts by default. Pass include_zero=true
  // when the user has ticked "Show zero-balance accounts" so they actually
  // come back from the API — otherwise the checkbox would be a no-op
  // because those rows were never in the response.
  if (includeZero) params.set('include_zero', 'true');
  const r = await fetch(`/api/bookkeeping/books/${bookId}/balances?${params}`);
  if (!r.ok) throw new Error('Failed to load balances');
  const d = await r.json();
  return {
    accounts: (d.accounts ?? []) as AccountBalance[],
    netProfit: typeof d.net_profit === 'number' ? d.net_profit : 0,
  };
}

export default function BalanceSheetTab({ bookId, onOpenAccount, embedded, onCsvRows }: Props) {
  // Period from the header bar. Balance sheet is "as at" period.toIso —
  // the from date doesn't apply (balances are cumulative from the start
  // of the book).
  const nav = useBookNavigation();
  const dataVersion = nav?.dataVersion;
  const activePeriod = nav?.activePeriod ?? { ready: false, fromIso: null, toIso: null, label: '' };
  const period: DateRange = useMemo(() => ({ from: activePeriod.fromIso, to: activePeriod.toIso }), [activePeriod.fromIso, activePeriod.toIso]);

  const [showZero, setShowZero] = useState(false);
  const printRootRef = useRef<HTMLDivElement>(null);
  const [current, setCurrent] = useState<AccountBalance[]>([]);
  const [prior, setPrior]     = useState<AccountBalance[]>([]);
  const [currentNetProfit, setCurrentNetProfit] = useState(0);
  const [priorNetProfit, setPriorNetProfit]     = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');

  const asAtCurrent = period.to;
  const asAtPrior   = period.to ? isoOneYearBefore(period.to) : null;

  useEffect(() => {
    if (!activePeriod.ready) {
      setCurrent([]); setPrior([]); setCurrentNetProfit(0); setPriorNetProfit(0);
      return;
    }
    let cancelled = false;
    async function go() {
      setLoading(true); setError('');
      try {
        const [cur, pri] = await Promise.all([
          fetchBalances(bookId, asAtCurrent, showZero),
          asAtPrior
            ? fetchBalances(bookId, asAtPrior, showZero)
            : Promise.resolve({ accounts: [] as AccountBalance[], netProfit: 0 } as BalancesResult),
        ]);
        if (cancelled) return;
        setCurrent(cur.accounts);
        setPrior(pri.accounts);
        setCurrentNetProfit(cur.netProfit);
        setPriorNetProfit(pri.netProfit);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void go();
    return () => { cancelled = true; };
    // showZero re-runs the fetch so zero-balance rows can come back from
    // the server (the response is filtered by include_zero, so a client-side
    // filter alone can't surface rows that weren't in the original response).
  }, [bookId, activePeriod.ready, asAtCurrent, asAtPrior, showZero, dataVersion]);

  type Row = { id: string; name: string; ledger: string | null; code: string | null; current: number; prior: number };
  /** Within a section, rows are grouped by ledger so the report reads like
   *  VT's BS (FA - equipment, fixture; FA - vehicles; Customers; Bank; etc.
   *  each get their own labelled block with a sub-total). */
  type LedgerGroup = { ledger: string; rows: Row[]; currentTotal: number; priorTotal: number };
  type Section = {
    key: BsGroup;
    title: string;
    groups: LedgerGroup[];
    currentTotal: number;
    priorTotal: number;
  };

  const sections: Section[] = useMemo(() => {
    return SECTIONS.map(def => {
      const inSection = (acc: AccountBalance[]) => acc.filter(a => bsGroupOf(a.ledger, a.account_type) === def.key);
      const cur = inSection(current);
      const pri = inSection(prior);
      const idMap = new Map<string, { name: string; ledger: string | null; code: string | null; current: number; prior: number }>();
      for (const a of cur) {
        idMap.set(a.id, { name: a.name, ledger: a.ledger, code: a.code ?? null, current: displayValue(a), prior: 0 });
      }
      for (const a of pri) {
        const entry = idMap.get(a.id) ?? { name: a.name, ledger: a.ledger, code: a.code ?? null, current: 0, prior: 0 };
        entry.prior = displayValue(a);
        idMap.set(a.id, entry);
      }
      const rows: Row[] = [...idMap.entries()]
        .map(([id, v]) => ({ id, ...v }))
        .filter(r => showZero || Math.abs(r.current) >= 0.005 || Math.abs(r.prior) >= 0.005);

      // Group by ledger — VT-style sub-headers. Accounts with no ledger
      // fall into a synthetic "(Unledgered)" bucket so they're still visible
      // rather than silently disappearing.
      const byLedger = new Map<string, Row[]>();
      for (const r of rows) {
        const key = (r.ledger ?? '').trim() || '(Unledgered)';
        const list = byLedger.get(key) ?? [];
        list.push(r);
        byLedger.set(key, list);
      }
      const groups: LedgerGroup[] = [...byLedger.entries()]
        .map(([ledger, rs]) => {
          const sorted = rs.sort((a, b) => a.name.localeCompare(b.name));
          return {
            ledger,
            rows: sorted,
            currentTotal: sorted.reduce((s, r) => s + r.current, 0),
            priorTotal:   sorted.reduce((s, r) => s + r.prior,   0),
          };
        })
        .sort((a, b) => a.ledger.localeCompare(b.ledger));

      const currentTotal = groups.reduce((s, g) => s + g.currentTotal, 0);
      const priorTotal   = groups.reduce((s, g) => s + g.priorTotal,   0);
      return { key: def.key, title: def.title, groups, currentTotal, priorTotal };
    });
  }, [current, prior, showZero]);

  const totals = useMemo(() => {
    const get = (key: BsGroup) => sections.find(s => s.key === key)!;
    const totalAssets       = get('fixed_assets').currentTotal + get('current_assets').currentTotal;
    const totalLiabilities  = get('current_liabilities').currentTotal + get('long_term_liabilities').currentTotal;
    const netAssets         = totalAssets - totalLiabilities;
    // Capital and reserves = posted equity ledgers + the current-year profit
    // that hasn't yet been carried to reserves via a year-end journal. For a
    // closed year netProfit is ~0 (already transferred), so this is a no-op;
    // for the open year it's the live result, which is exactly what makes the
    // BS balance without a posted YET (VT-style dynamic carry).
    const equityLedgers     = get('equity').currentTotal;
    const totalCapital      = +(equityLedgers + currentNetProfit).toFixed(2);
    const balanceCheck      = +(netAssets - totalCapital).toFixed(2);
    const priorAssets       = get('fixed_assets').priorTotal + get('current_assets').priorTotal;
    const priorLiabilities  = get('current_liabilities').priorTotal + get('long_term_liabilities').priorTotal;
    const priorNetAssets    = priorAssets - priorLiabilities;
    const priorEquityLedgers = get('equity').priorTotal;
    const priorCapital      = +(priorEquityLedgers + priorNetProfit).toFixed(2);
    return {
      totalAssets, totalLiabilities, netAssets, totalCapital, balanceCheck,
      priorAssets, priorLiabilities, priorNetAssets, priorCapital,
    };
  }, [sections, currentNetProfit, priorNetProfit]);

  const hasMovement = sections.some(s => s.groups.length > 0);

  // CSV rows — single source for the Export button and the onCsvRows callback
  // (so the MA pack's Excel export gets the exact on-screen shape).
  const csvRows: CsvRow[] = useMemo(() => {
    const curLabel = asAtCurrent ? `As at ${asAtCurrent}` : 'Current';
    const priLabel = asAtPrior   ? `As at ${asAtPrior}`   : 'Prior';
    const rows: CsvRow[] = [['Section', 'Ledger', 'Account', curLabel, priLabel]];
    for (const s of sections) {
      if (s.groups.length === 0) continue;
      for (const g of s.groups) {
        rows.push([s.title, g.ledger, '', '', '']);
        for (const r of g.rows) rows.push([s.title, g.ledger, r.name, r.current.toFixed(2), r.prior.toFixed(2)]);
        rows.push([s.title, g.ledger, `${g.ledger} total`, g.currentTotal.toFixed(2), g.priorTotal.toFixed(2)]);
      }
      if (s.key === 'equity' && (Math.abs(currentNetProfit) >= 0.005 || Math.abs(priorNetProfit) >= 0.005)) {
        rows.push([s.title, '', 'Profit/(loss) for the financial year', currentNetProfit.toFixed(2), priorNetProfit.toFixed(2)]);
      }
      const sectionCur = s.key === 'equity' ? totals.totalCapital : s.currentTotal;
      const sectionPri = s.key === 'equity' ? totals.priorCapital : s.priorTotal;
      rows.push([s.title, '', `${s.title} total`, sectionCur.toFixed(2), sectionPri.toFixed(2)]);
    }
    rows.push(['', '', 'Total assets',      totals.totalAssets.toFixed(2),      totals.priorAssets.toFixed(2)]);
    rows.push(['', '', 'Total liabilities', totals.totalLiabilities.toFixed(2), totals.priorLiabilities.toFixed(2)]);
    rows.push(['', '', 'Net assets',        totals.netAssets.toFixed(2),        totals.priorNetAssets.toFixed(2)]);
    rows.push(['', '', 'Total capital and reserves', totals.totalCapital.toFixed(2), totals.priorCapital.toFixed(2)]);
    return rows;
  }, [sections, totals, currentNetProfit, priorNetProfit, asAtCurrent, asAtPrior]);
  const onCsvRowsRef = useRef(onCsvRows); onCsvRowsRef.current = onCsvRows;
  useEffect(() => { onCsvRowsRef.current?.(csvRows); }, [csvRows]);

  // Empty state placed AFTER all hook calls so the hook count stays
  // constant across renders (Rules of Hooks).
  if (!activePeriod.ready) return <PeriodEmptyState reportName="balance sheet" />;

  return (
    <div className={`space-y-3 ${embedded ? '' : 'bk-print-root'}`} ref={printRootRef}>
      {!embedded && (
        <ReportPrintHeader
          bookId={bookId}
          reportTitle="Balance Sheet"
          periodDescription={`As at ${activePeriod.label.replace(/^Year to\s+/, '')}`}
        />
      )}
      {/* Embedded in the MA pack: a plain statement heading; the pack header
          above carries the entity name + period. */}
      {embedded && (
        <h3 className="text-sm font-semibold text-slate-900 px-1">Balance Sheet</h3>
      )}
      {!embedded && (
      <div className="flex items-center gap-3 flex-wrap print-hidden">
        <h2 className="text-sm font-semibold text-slate-900">
          Balance Sheet
          <span className="text-xs font-normal text-slate-500 ml-2">· as at {activePeriod.label}</span>
        </h2>
        <label className="text-xs text-slate-600 inline-flex items-center gap-1.5 ml-auto">
          <input type="checkbox" checked={showZero} onChange={e => setShowZero(e.target.checked)} className="rounded border-slate-300" />
          Show zero-balance accounts
        </label>
        <button
          type="button"
          onClick={() => printReport(printRootRef.current, `Balance Sheet — ${activePeriod.label}`)}
          className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700"
        >
          <Printer size={12} /> Print
        </button>
        <button
          type="button"
          onClick={() => exportRowsAsCsv(`Balance Sheet — ${activePeriod.label}.csv`, csvRows)}
          className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700"
        >
          <Download size={12} /> Export
        </button>
      </div>
      )}

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
        <div className="border border-slate-200 rounded-xl overflow-hidden bg-white shadow-sm bk-print-area">
          <table className="w-full text-sm">
            <colgroup>
              <col />
              <col className="w-40" />
              <col className="w-40" />
            </colgroup>
            <thead className="bk-sticky-thead">
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
              {(sections[0].groups.length > 0 || sections[1].groups.length > 0) && (
                <>
                  <BsTitle title="Assets" />
                  <BsSection section={sections[0]} onOpenAccount={onOpenAccount} />
                  <BsSection section={sections[1]} onOpenAccount={onOpenAccount} />
                  <BsSubtotal label="Total assets" current={totals.totalAssets} prior={totals.priorAssets} />
                </>
              )}

              {/* Liabilities */}
              {(sections[2].groups.length > 0 || sections[3].groups.length > 0) && (
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
              {(sections[4].groups.length > 0 || Math.abs(currentNetProfit) >= 0.005 || Math.abs(priorNetProfit) >= 0.005) && (
                <>
                  <BsTitle title="Capital and reserves" />
                  <BsSection section={sections[4]} onOpenAccount={onOpenAccount} hideSectionLabel />
                  {/* Derived current-year result — not a posted account. Carries
                      to reserves only when the year is formally closed (YET). */}
                  {(Math.abs(currentNetProfit) >= 0.005 || Math.abs(priorNetProfit) >= 0.005) && (
                    <tr className="hover:bg-slate-50">
                      <td className="px-6 py-1 pl-12 text-slate-700">Profit/(loss) for the financial year</td>
                      <td className="px-6 py-1 text-right tabular-nums text-slate-700">{fmt(currentNetProfit)}</td>
                      <td className="px-6 py-1 text-right tabular-nums text-slate-700">{fmt(priorNetProfit)}</td>
                    </tr>
                  )}
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
    if (section.groups.length === 0) return null;
    return (
      <>
        {!hideSectionLabel && (
          <tr>
            <td colSpan={3} className="px-6 pt-2 pb-0.5 pl-10 text-[11px] uppercase tracking-wide font-medium text-slate-500">{section.title}</td>
          </tr>
        )}
        {/* VT-style: ledger sub-header → accounts in the ledger → ledger
            sub-total. So "Bank" / "Customers" / "FA - vehicles" each get
            their own labelled block within the Section bucket. */}
        {section.groups.map(g => (
          <BsLedgerGroup key={g.ledger} group={g} onOpenAccount={onOpenAccount} />
        ))}
        {/* Section total (Total fixed assets / Total current assets etc.) */}
        <tr>
          <td className="px-6 py-1" />
          <td className="px-6 py-1 text-right tabular-nums text-slate-900 border-t border-slate-300">{fmt(section.currentTotal)}</td>
          <td className="px-6 py-1 text-right tabular-nums text-slate-900 border-t border-slate-300">{fmt(section.priorTotal)}</td>
        </tr>
      </>
    );
  }

  function BsLedgerGroup({ group, onOpenAccount }: {
    group: LedgerGroup;
    onOpenAccount?: Props['onOpenAccount'];
  }) {
    return (
      <>
        {/* Ledger sub-header — small caps, indented under the section title. */}
        <tr>
          <td colSpan={3} className="px-6 pt-1.5 pb-0.5 pl-12 text-[11px] font-semibold text-slate-700">
            {group.ledger}
          </td>
        </tr>
        {group.rows.map(r => (
          <tr key={r.id} className="hover:bg-slate-50">
            <td className="px-6 py-1 pl-16">
              {onOpenAccount ? (
                <button
                  type="button"
                  onClick={() => onOpenAccount({ id: r.id, name: r.name, ledger: r.ledger, code: r.code })}
                  className="text-indigo-700 hover:underline text-left"
                >
                  <AccountCodeTag code={r.code} className="mr-2" />
                  {r.name}
                </button>
              ) : (
                <span className="text-indigo-700"><AccountCodeTag code={r.code} className="mr-2" />{r.name}</span>
              )}
            </td>
            <td className="px-6 py-1 text-right tabular-nums text-slate-700">{fmt(r.current)}</td>
            <td className="px-6 py-1 text-right tabular-nums text-slate-700">{fmt(r.prior)}</td>
          </tr>
        ))}
        {/* Ledger sub-total — VT shows this even for single-row ledgers. */}
        <tr>
          <td className="px-6 py-0.5" />
          <td className="px-6 py-0.5 text-right tabular-nums text-slate-700 border-t border-slate-200">{fmt(group.currentTotal)}</td>
          <td className="px-6 py-0.5 text-right tabular-nums text-slate-700 border-t border-slate-200">{fmt(group.priorTotal)}</td>
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
