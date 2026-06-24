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

import { useEffect, useMemo, useRef, useState } from 'react';
import { printReport } from './printReport';
import { exportRowsAsCsv, type CsvRow } from './exportReportCsv';
import { AccountCodeTag } from '@/lib/bookkeeping/useAccountCodes';
import { Loader2, Printer, Download, FileBarChart2 } from 'lucide-react';
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
}

// P&L "preferred" sections — these get a fixed slot at the top of the report
// in the canonical accountant's order. Any OTHER ledger that contains
// income/expense accounts is appended dynamically after these, so a book with
// a custom ledger like "Marketing expenses" (or anything we haven't seen
// before — incl. imported COA from VT) still shows up rather than vanishing.
const PL_PREFERRED_SECTIONS: { ledger: string; title: string; bucket: 'income' | 'cost_of_sales' | 'expense' | 'taxation' }[] = [
  { ledger: 'Income',        title: 'Income',        bucket: 'income'        },
  { ledger: 'Cost of sales', title: 'Cost of sales', bucket: 'cost_of_sales' },
  { ledger: 'Expenses',      title: 'Expenses',      bucket: 'expense'       },
  { ledger: 'Taxation',      title: 'Taxation',      bucket: 'taxation'      },
];

/** Decide which subtotal a section contributes to. Driven by ledger-name
 *  hints first, then by the account_type as a backstop, so an unfamiliar
 *  ledger like "Marketing" still lands in the right bucket. */
function bucketForLedger(ledger: string, sampleAccountType: string): 'income' | 'cost_of_sales' | 'expense' | 'taxation' {
  const lc = ledger.toLowerCase();
  if (lc === 'income' || lc.includes('income') || lc.includes('sales') || lc.includes('revenue')) return 'income';
  if (lc === 'cost of sales' || lc.includes('cost of sales') || lc.includes('cogs')) return 'cost_of_sales';
  if (lc === 'taxation' || lc.includes('tax')) return 'taxation';
  if (sampleAccountType === 'income') return 'income';
  return 'expense';
}

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

async function fetchBalances(bookId: string, range: DateRange, includeZero: boolean): Promise<AccountBalance[]> {
  const params = new URLSearchParams();
  if (range.from) params.set('from', range.from);
  if (range.to)   params.set('to',   range.to);
  // Exclude year-end closing journals from the P&L aggregation. YET entries
  // clear P&L accounts into Retained Earnings — if we include them, every
  // income/expense account nets to zero and the report looks empty.
  // The Balance Sheet does NOT pass this flag because YET is exactly what
  // updates Retained Earnings.
  params.set('exclude_types', 'YET');
  // When the user wants to see zero-balance accounts, we have to ask the
  // server for them — the balances endpoint hides accounts with no movement
  // by default. Without this, the "Show zero-balance accounts" checkbox in
  // the toolbar would be a no-op because those rows were never in the
  // response in the first place.
  if (includeZero) params.set('include_zero', 'true');
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
  // Period comes from the header's year/period bar via BookNavigation. The
  // old in-tab PeriodSelector has been removed.
  const nav = useBookNavigation();
  const activePeriod = nav?.activePeriod ?? { ready: false, fromIso: null, toIso: null, label: '' };
  const period: DateRange = useMemo(() => ({ from: activePeriod.fromIso, to: activePeriod.toIso }), [activePeriod.fromIso, activePeriod.toIso]);

  const [current, setCurrent] = useState<AccountBalance[]>([]);
  const [prior, setPrior]     = useState<AccountBalance[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');
  const [showZero, setShowZero] = useState(false);
  const printRootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!activePeriod.ready) { setCurrent([]); setPrior([]); return; }
    let cancelled = false;
    async function go() {
      setLoading(true); setError('');
      try {
        const priorPeriod = computePriorPeriod(period);
        const [cur, pri] = await Promise.all([
          fetchBalances(bookId, period, showZero),
          priorPeriod.from && priorPeriod.to
            ? fetchBalances(bookId, priorPeriod, showZero)
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
    // showZero is in the deps so toggling the checkbox triggers a refetch
    // that pulls the zero-balance rows in (rather than relying on
    // post-filter only, which only works for rows already in the cache).
  }, [bookId, activePeriod.ready, period.from, period.to, showZero]);

  const priorPeriod = useMemo(() => computePriorPeriod(period), [period.from, period.to]);

  // ── Build the per-section grouped data ──────────────────────────────────
  type Row = { id: string; name: string; ledger: string | null; code: string | null; current: number; prior: number };
  type Section = {
    title: string;
    ledger: string;
    bucket: 'income' | 'cost_of_sales' | 'expense' | 'taxation';
    rows: Row[];
    currentTotal: number;
    priorTotal: number;
  };

  const sections: Section[] = useMemo(() => {
    // 1. Find every ledger that contains at least one P&L account (income or
    //    expense account_type) across either period. This way an imported COA
    //    with custom ledger names still shows up, instead of being filtered
    //    out by the old "exact ledger name match" rule.
    const plTypes: ReadonlySet<string> = new Set(['income', 'expense']);
    const ledgerSet = new Set<string>();
    const sampleTypeByLedger = new Map<string, string>();
    for (const a of [...current, ...prior]) {
      if (!plTypes.has(a.account_type)) continue;
      const lg = (a.ledger ?? '').trim();
      if (!lg) continue;
      ledgerSet.add(lg);
      if (!sampleTypeByLedger.has(lg)) sampleTypeByLedger.set(lg, a.account_type);
    }

    // 2. Order: preferred sections first (in canonical order), then any
    //    unfamiliar ledgers sorted alphabetically.
    const preferredNames = new Set(PL_PREFERRED_SECTIONS.map(s => s.ledger));
    const orderedLedgers: { ledger: string; title: string; bucket: Section['bucket'] }[] = [];
    for (const def of PL_PREFERRED_SECTIONS) {
      if (ledgerSet.has(def.ledger)) {
        orderedLedgers.push({ ledger: def.ledger, title: def.title, bucket: def.bucket });
      }
    }
    const extras = [...ledgerSet]
      .filter(l => !preferredNames.has(l))
      .sort((a, b) => a.localeCompare(b));
    for (const lg of extras) {
      orderedLedgers.push({
        ledger: lg,
        title: lg,
        bucket: bucketForLedger(lg, sampleTypeByLedger.get(lg) ?? 'expense'),
      });
    }

    // 3. For each section, walk current + prior balances, dedupe rows by id.
    return orderedLedgers.map(def => {
      const inLedger = (acc: AccountBalance[]) =>
        acc.filter(a => (a.ledger ?? '').trim() === def.ledger && plTypes.has(a.account_type));
      const cur = inLedger(current);
      const pri = inLedger(prior);
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
        .filter(r => showZero || Math.abs(r.current) >= 0.005 || Math.abs(r.prior) >= 0.005)
        .sort((a, b) => a.name.localeCompare(b.name));
      const currentTotal = rows.reduce((s, r) => s + r.current, 0);
      const priorTotal   = rows.reduce((s, r) => s + r.prior,   0);
      return { title: def.title, ledger: def.ledger, bucket: def.bucket, rows, currentTotal, priorTotal };
    });
  }, [current, prior, showZero]);

  // Bucket totals — sum across every section that lands in each bucket, so
  // a book with custom "Marketing" / "R&D" ledgers still rolls them into the
  // Expenses subtotal rather than orphaning them.
  function sumBucket(b: Section['bucket']): { current: number; prior: number } {
    return sections.filter(s => s.bucket === b).reduce(
      (acc, s) => ({ current: acc.current + s.currentTotal, prior: acc.prior + s.priorTotal }),
      { current: 0, prior: 0 },
    );
  }
  const incomeT  = sumBucket('income');
  const cosT     = sumBucket('cost_of_sales');
  const expT     = sumBucket('expense');
  const taxT     = sumBucket('taxation');
  const gross     = { current: incomeT.current - cosT.current, prior: incomeT.prior - cosT.prior };
  const operating = { current: gross.current - expT.current,   prior: gross.prior - expT.prior   };
  const net       = { current: operating.current - taxT.current, prior: operating.prior - taxT.prior };

  const hasMovement = sections.some(s => s.rows.length > 0);

  // Empty state when no year-end is set / no period chosen. Placed AFTER
  // every hook so the hook count stays constant across renders.
  if (!activePeriod.ready) return <PeriodEmptyState reportName="profit & loss" />;

  return (
    <div className="space-y-3 bk-print-root" ref={printRootRef}>
      <ReportPrintHeader
        bookId={bookId}
        reportTitle="Profit and Loss Account"
        periodDescription={`For the year ended ${activePeriod.label.replace(/^Year to\s+/, '')}`}
      />
      {/* Period now lives in the header bar; tab toolbar only shows the
          report title + view options + actions. */}
      <div className="flex items-center gap-3 flex-wrap print-hidden">
        <h2 className="text-sm font-semibold text-slate-900">
          Profit &amp; Loss
          <span className="text-xs font-normal text-slate-500 ml-2">· {activePeriod.label}</span>
        </h2>
        <label className="text-xs text-slate-600 inline-flex items-center gap-1.5 ml-auto">
          <input type="checkbox" checked={showZero} onChange={e => setShowZero(e.target.checked)} className="rounded border-slate-300" />
          Show zero-balance accounts
        </label>
        <button
          type="button"
          onClick={() => printReport(printRootRef.current, `Profit and Loss — ${activePeriod.label}`)}
          className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700"
        >
          <Printer size={12} /> Print
        </button>
        <button
          type="button"
          onClick={() => {
            // Section header → account rows → section subtotal, mirroring
            // the on-screen layout so the numbers line up with what the
            // user sees. Last two rows: Gross profit, Operating profit,
            // Net profit (same triple shown at the bottom of the report).
            const curLabel = periodHeader(period);
            const priLabel = periodHeader(priorPeriod);
            const rows: CsvRow[] = [['Section', 'Account', curLabel, priLabel]];
            for (const s of sections) {
              if (s.rows.length === 0) continue;
              rows.push([s.title, '', '', '']);
              for (const r of s.rows) {
                rows.push([s.title, r.name, r.current.toFixed(2), r.prior.toFixed(2)]);
              }
              rows.push([s.title, `${s.title} total`, s.currentTotal.toFixed(2), s.priorTotal.toFixed(2)]);
            }
            rows.push(['', 'Gross profit', gross.current.toFixed(2), gross.prior.toFixed(2)]);
            rows.push(['', 'Operating profit', operating.current.toFixed(2), operating.prior.toFixed(2)]);
            rows.push(['', 'Net profit', net.current.toFixed(2), net.prior.toFixed(2)]);
            exportRowsAsCsv(`Profit and Loss — ${activePeriod.label}.csv`, rows);
          }}
          className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700"
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
